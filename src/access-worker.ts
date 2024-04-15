interface FileSystemSyncAccessHandle {
  read: (container: ArrayBuffer, opts: { at: number }) => number;
  write: (data: ArrayBuffer | ArrayBufferView, opts?: { at: number }) => number;
  flush: () => void;
  close: () => void;
  truncate: (newSize: number) => void;
  getSize: () => number;
}

type Async<F> = F extends (...args: infer Params) => infer R
  ? (...args: Params) => Promise<R>
  : never;

type WorkerMsg = {
  data: {
    cbId: number;
    returnVal?: unknown;
    evtType: string;
    errMsg: string;
  };
};
export type OPFSWorkerAccessHandle = {
  read: (offset: number, size: number) => Promise<ArrayBuffer>;
  write: Async<FileSystemSyncAccessHandle['write']>;
  close: Async<FileSystemSyncAccessHandle['close']>;
  truncate: Async<FileSystemSyncAccessHandle['truncate']>;
  getSize: Async<FileSystemSyncAccessHandle['getSize']>;
  flush: Async<FileSystemSyncAccessHandle['flush']>;
};

export async function createOPFSAccess(
  filePath: string
): Promise<OPFSWorkerAccessHandle> {
  const opfsAction = getWorkerMessenger();
  await opfsAction('register', { filePath });

  return {
    read: async (offset, size) =>
      (await opfsAction('read', {
        filePath,
        offset,
        size,
      })) as ArrayBuffer,
    write: async (data, opts) =>
      (await opfsAction(
        'write',
        {
          filePath,
          data,
          opts,
        },
        [ArrayBuffer.isView(data) ? data.buffer : data]
      )) as number,
    close: async () =>
      (await opfsAction('close', {
        filePath,
      })) as void,
    truncate: async (newSize: number) =>
      (await opfsAction('truncate', {
        filePath,
        newSize,
      })) as void,
    getSize: async () =>
      (await opfsAction('getSize', {
        filePath,
      })) as number,
    flush: async () =>
      (await opfsAction('flush', {
        filePath,
      })) as void,
  };
}

const messengerCache: Array<Function> = [];
let nextMsgerIdx = 0;

function getWorkerMessenger() {
  // Create a maximum of three workers

  if (messengerCache.length < 3) {
    createWorker();
    messengerCache.push(createWorker());
    return createWorker();
  } else {
    const msger = messengerCache[nextMsgerIdx];
    nextMsgerIdx = (nextMsgerIdx + 1) % messengerCache.length;
    return msger;
  }

  function createWorker() {
    const blob = new Blob([`(${opfsWorkerSetup})()`]);
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    let cbId = 0;
    const cbFns: Record<number, { resolve: Function; reject: Function }> = {};

    worker.onmessage = ({ data }: WorkerMsg) => {
      if (data.evtType === 'callback') {
        cbFns[data.cbId]?.resolve(data.returnVal);
      }
      if (data.evtType === 'throwError') {
        cbFns[data.cbId]?.reject(Error(data.errMsg));
      }
      delete cbFns[data.cbId];
    };

    return async function sendMessage(
      evtType: string,
      args: any,
      trans: Transferable[] = []
    ) {
      cbId += 1;

      const rsP = new Promise((resolve, reject) => {
        cbFns[cbId] = { resolve, reject };
      });

      const message = {
        cbId,
        evtType,
        args,
      };
      worker.postMessage(message, trans);

      return rsP;
    };
  }
}

const opfsWorkerSetup = ((): void => {
  type SplitFilePath = {
    parentPath: string | null;
    fileName: string;
  };
  function splitFilePath(filePath: string): SplitFilePath {
    if (filePath === '/') return { parentPath: null, fileName: '' };

    const fullPathArray = filePath
      .split('/')
      .filter((parentPath) => parentPath.length > 0);

    if (fullPathArray.length === 0) {
      throw new Error('Invalid path');
    }

    const fileName = fullPathArray[fullPathArray.length - 1];
    const parentPath = '/' + fullPathArray.slice(0, -1).join('/');

    return { fileName, parentPath };
  }

  async function getFileSystemHandle(
    path: string,
    opts: {
      create?: boolean;
      isFile?: boolean;
    }
  ) {
    const { parentPath, fileName } = splitFilePath(path);
    if (parentPath === null) {
      return await navigator.storage.getDirectory();
    }

    const dirPaths = parentPath.split('/').filter((s) => s.length > 0);

    try {
      let root = await navigator.storage.getDirectory();
      for (const directory of dirPaths) {
        root = await root.getDirectoryHandle(directory, {
          create: opts.create,
        });
      }
      if (opts.isFile) {
        return await root.getFileHandle(fileName, {
          create: opts.create,
        });
      } else {
        return await root.getDirectoryHandle(fileName, {
          create: opts.create,
        });
      }
    } catch (err) {
      return console.error(err);
    }
  }

  const fileAccesserMap: Record<string, FileSystemSyncAccessHandle> = {};

  self.onmessage = async (e) => {
    const { evtType, args } = e.data;

    let accessHandle = fileAccesserMap[args.filePath];
    const fileHandle = (await getFileSystemHandle(args.filePath, {
      create: true,
      isFile: true,
    })) as FileSystemFileHandle;

    try {
      let returnVal;
      const trans: Transferable[] = [];
      if (evtType === 'register') {
        // @ts-expect-error function available only in worker
        accessHandle = await fileHandle.createSyncAccessHandle();
        fileAccesserMap[args.filePath] = accessHandle;
      }
      if (evtType === 'getSize') {
        returnVal = accessHandle.getSize();
      }
      if (evtType === 'truncate') {
        accessHandle.truncate(args.newSize);
      }
      if (evtType === 'write') {
        const { data, opts } = e.data.args;
        returnVal = accessHandle.write(data, opts);
      }
      if (evtType === 'close') {
        accessHandle.close();
        delete fileAccesserMap[args.filePath];
      }

      if (evtType === 'read') {
        const { offset, size } = e.data.args;
        const buf = new ArrayBuffer(size);
        const readLen = accessHandle.read(buf, { at: offset });
        returnVal =
          readLen === size
            ? buf
            : // @ts-expect-error transfer support by chrome 114
              buf.transfer?.(readLen) ?? buf.slice(0, readLen);
        trans.push(returnVal);
      }

      if (evtType === 'flush') {
        accessHandle.flush();
      }

      self.postMessage(
        {
          evtType: 'callback',
          cbId: e.data.cbId,
          returnVal,
        },
        // @ts-expect-error
        trans
      );
    } catch (error) {
      const err = error as Error;
      self.postMessage({
        evtType: 'throwError',
        cbId: e.data.cbId,
        errMsg: err.name + ': ' + err.message + '\n' + JSON.stringify(e.data),
      });
    }
  };
}).toString();

type SplitFilePath = {
  parentPath: string | null
  fileName: string
}
export function splitFilePath(filePath: string): SplitFilePath {
  if (filePath === '/') return { parentPath: null, fileName: '' }

  const fullPathArray = filePath
    .split('/')
    .filter((parentPath) => parentPath.length > 0)

  if (fullPathArray.length === 0) {
    throw Error('Invalid path')
  }

  const fileName = fullPathArray[fullPathArray.length - 1]
  const parentPath = '/' + fullPathArray.slice(0, -1).join('/')

  return { fileName, parentPath }
}

export async function getFileSystemHandle(
  path: string,
  opts: {
    create?: boolean
    isFile?: boolean
  },
) {
  const { parentPath, fileName } = splitFilePath(path)
  if (parentPath === null) {
    return await navigator.storage.getDirectory()
  }

  const dirPaths = parentPath.split('/').filter((s) => s.length > 0)

  try {
    let root = await navigator.storage.getDirectory()
    for (const directory of dirPaths) {
      root = await root.getDirectoryHandle(directory, {
        create: opts.create,
      })
    }
    if (opts.isFile) {
      return await root.getFileHandle(fileName, {
        create: opts.create,
      })
    } else {
      return await root.getDirectoryHandle(fileName, {
        create: opts.create,
      })
    }
  } catch (err) {
    return console.error(err)
  }
}

export async function remove(path: string) {
  const { parentPath, fileName } = splitFilePath(path)
  if (parentPath == null) {
    const root = await navigator.storage.getDirectory()
    for await (const it of root.keys()) {
      await root.removeEntry(it, { recursive: true })
    }
    return
  }

  const dirHandle = (await getFileSystemHandle(parentPath, {
    create: false,
    isFile: false,
  })) as FileSystemDirectoryHandle | null
  if (dirHandle == null) return

  await dirHandle.removeEntry(fileName, { recursive: true })
}

export function joinPath(p1: string, p2: string) {
  return `${p1}/${p2}`.replace('//', '/')
}

import React, { useState, useEffect } from 'react';
import { DndProvider } from 'react-dnd';
import { ThemeProvider, CssBaseline } from '@mui/material';
import Button from '@mui/material/Button';
import AddIcon from '@mui/icons-material/Add';
import {
  Tree,
  MultiBackend,
  getDescendants,
  getBackendOptions,
} from '@minoru/react-dnd-treeview';
import { CustomNode } from './CustomNode';
import { CustomDragPreview } from './CustomDragPreview';
import { AddDialog } from './AddDialog';
import { theme } from './theme';
import styles from './App.module.css';
import SampleData from './sample_data.json';
import { file, dir, write } from '../../../src/';

const getLastId = (treeData) => {
  const reversedArray = [...treeData].sort((a, b) => {
    if (a.id < b.id) {
      return 1;
    } else if (a.id > b.id) {
      return -1;
    }

    return 0;
  });

  if (reversedArray.length > 0) {
    return reversedArray[0].id;
  }

  return 0;
};

async function initFiles() {
  if ((await dir('/').children()).length != 0) return;

  await write('/opfs-tools/dir1/file1', 'file');
  await write('/opfs-tools/dir1/file2', 'file');
  await write('/opfs-tools/dir2/file1', 'file');
  await write('/.Trush/xxx', 'xxx');
}

async function getInitData(dirPath, rs) {
  for (const it of await dir(dirPath).children()) {
    rs.push({
      id: it.path,
      parent: it.parent.path,
      droppable: it.kind === 'dir',
      text: it.name,
      data: {
        fileType: 'text',
        fileSize: '0KB',
      },
    });
    if (it.kind === 'dir') {
      await getInitData(it.path, rs);
    }
  }
}

function App() {
  const [treeData, setTreeData] = useState([]);
  const handleDrop = (newTree) => setTreeData(newTree);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      await initFiles();
      const tree = [
        {
          id: '/',
          parent: 0,
          droppable: false,
          text: 'root',
          data: {
            fileType: 'text',
            fileSize: '0KB',
          },
        },
      ];
      await getInitData('/', tree);
      setTreeData(tree);
    })();
  }, []);

  const handleDelete = async (id) => {
    await file(id).remove();
    const deleteIds = [
      id,
      ...getDescendants(treeData, id).map((node) => node.id),
    ];
    const newTree = treeData.filter((node) => !deleteIds.includes(node.id));

    setTreeData(newTree);
  };

  const handleCopy = async (id) => {
    const lastId = getLastId(treeData);
    const targetNode = treeData.find((n) => n.id === id);
    const descendants = getDescendants(treeData, id);
    const partialTree = descendants.map((node) => ({
      ...node,
      id: node.id + lastId,
      parent: node.parent + lastId,
    }));

    const newName = targetNode.text + ' copy';
    const newNode = {
      ...targetNode,
      text: newName,
      id: targetNode.parent + '/' + newName,
    };
    await write(newNode.id, file(targetNode.id));

    setTreeData([...treeData, newNode, ...partialTree]);
  };

  const handleOpenDialog = () => {
    setOpen(true);
  };

  const handleCloseDialog = () => {
    setOpen(false);
  };

  const handleSubmit = (newNode) => {
    const lastId = getLastId(treeData) + 1;

    setTreeData([
      ...treeData,
      {
        ...newNode,
        id: lastId,
      },
    ]);

    setOpen(false);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <DndProvider backend={MultiBackend} options={getBackendOptions()}>
        <div className={styles.app}>
          <div>
            <Button onClick={handleOpenDialog} startIcon={<AddIcon />}>
              Add Node
            </Button>
            {open && (
              <AddDialog
                tree={treeData}
                onClose={handleCloseDialog}
                onSubmit={handleSubmit}
              />
            )}
          </div>
          <Tree
            tree={treeData}
            rootId={'/'}
            render={(node, options) => (
              <CustomNode
                node={node}
                {...options}
                onDelete={handleDelete}
                onCopy={handleCopy}
              />
            )}
            dragPreviewRender={(monitorProps) => (
              <CustomDragPreview monitorProps={monitorProps} />
            )}
            onDrop={handleDrop}
            classes={{
              root: styles.treeRoot,
              draggingSource: styles.draggingSource,
              dropTarget: styles.dropTarget,
            }}
          />
        </div>
      </DndProvider>
    </ThemeProvider>
  );
}

export default App;

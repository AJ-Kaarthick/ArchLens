import React, { useState, useMemo } from 'react';
import type { FileTreeItem } from '@archlens/shared';
import { Folder, FolderOpen, FileText, Search, Star } from 'lucide-react';

interface FileTreeExplorerProps {
  tree: FileTreeItem[];
  onSelectFile?: (_file: FileTreeItem) => void;
}

interface TreeNode {
  name: string;
  path: string;
  item?: FileTreeItem;
  children: Record<string, TreeNode>;
}

function buildTreeStructure(items: FileTreeItem[]): TreeNode {
  const root: TreeNode = { name: 'root', path: '', children: {} };

  for (const item of items) {
    const parts = item.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;

      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          item: isFile ? item : undefined,
          children: {},
        };
      }
      current = current.children[part];
    }
  }

  return root;
}

const CATEGORY_COLORS: Record<string, string> = {
  source: 'text-blue-400 bg-blue-950/60 border-blue-900/60',
  test: 'text-amber-400 bg-amber-950/60 border-amber-900/60',
  config: 'text-purple-400 bg-purple-950/60 border-purple-900/60',
  doc: 'text-emerald-400 bg-emerald-950/60 border-emerald-900/60',
  asset: 'text-pink-400 bg-pink-950/60 border-pink-900/60',
  ci: 'text-cyan-400 bg-cyan-950/60 border-cyan-900/60',
  other: 'text-slate-400 bg-slate-800 border-slate-700',
};

interface TreeNodeItemProps {
  node: TreeNode;
  level: number;
  onSelectFile?: (_file: FileTreeItem) => void;
}

const TreeNodeItem: React.FC<TreeNodeItemProps> = ({ node, level, onSelectFile }) => {
  const [isOpen, setIsOpen] = useState(level < 1);
  const isDirectory = Object.keys(node.children).length > 0 || !node.item;

  if (isDirectory) {
    const childEntries = Object.entries(node.children).sort(([aName, aNode], [bName, bNode]) => {
      const aIsDir = Object.keys(aNode.children).length > 0 || !aNode.item;
      const bIsDir = Object.keys(bNode.children).length > 0 || !bNode.item;
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return aName.localeCompare(bName);
    });

    return (
      <div>
        <div
          onClick={() => setIsOpen(!isOpen)}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          className="flex items-center gap-2 py-1.5 px-2 hover:bg-slate-800/80 rounded cursor-pointer text-xs text-slate-300 transition select-none"
        >
          {isOpen ? (
            <FolderOpen size={14} className="text-amber-400 shrink-0" />
          ) : (
            <Folder size={14} className="text-amber-400/80 shrink-0" />
          )}
          <span className="font-mono font-medium text-slate-200">{node.name}</span>
        </div>

        {isOpen && (
          <div>
            {childEntries.map(([childName, childNode]) => (
              <TreeNodeItem
                key={childName}
                node={childNode}
                level={level + 1}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File Item
  const item = node.item!;
  const catColor = CATEGORY_COLORS[item.category] || CATEGORY_COLORS.other;

  return (
    <div
      onClick={() => onSelectFile && onSelectFile(item)}
      style={{ paddingLeft: `${level * 16 + 8}px` }}
      className="flex items-center justify-between py-1 px-2 hover:bg-slate-800/90 rounded cursor-pointer text-xs text-slate-300 transition group"
    >
      <div className="flex items-center gap-2 truncate">
        <FileText size={13} className="text-slate-400 shrink-0" />
        <span className="font-mono text-slate-300 group-hover:text-blue-400 truncate">
          {node.name}
        </span>
        {item.isLandmark && (
          <Star size={11} className="text-yellow-400 shrink-0 fill-yellow-400/30" />
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-2">
        <span
          className={`text-[10px] uppercase font-mono px-1.5 py-0.2 rounded border ${catColor}`}
        >
          {item.category}
        </span>
        <span className="font-mono text-[11px] text-slate-400">
          {(item.size / 1024).toFixed(1)} KB
        </span>
      </div>
    </div>
  );
};

export const FileTreeExplorer: React.FC<FileTreeExplorerProps> = ({ tree, onSelectFile }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return tree;
    const term = searchTerm.toLowerCase();
    return tree.filter(
      (item) => item.path.toLowerCase().includes(term) || item.name.toLowerCase().includes(term)
    );
  }, [tree, searchTerm]);

  const treeRoot = useMemo(() => buildTreeStructure(filteredItems), [filteredItems]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Repository Tree Explorer
          </h3>
          <span className="text-xs text-slate-400">({filteredItems.length} files)</span>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Filter files..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-slate-800 border border-slate-700/80 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Tree View Container */}
      <div className="max-h-[500px] overflow-y-auto pr-2 border border-slate-800/80 rounded-lg p-2 bg-slate-950/50">
        {Object.entries(treeRoot.children).map(([name, node]) => (
          <TreeNodeItem key={name} node={node} level={0} onSelectFile={onSelectFile} />
        ))}
      </div>
    </div>
  );
};

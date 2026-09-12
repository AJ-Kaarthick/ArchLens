import React, { useState, useMemo } from 'react';
import type { FileTreeItem } from '@archlens/shared';
import {
  Folder,
  FolderOpen,
  FileText,
  Search,
  Star,
  ChevronRight,
  ChevronDown,
  X,
  FileCode,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card.tsx';
import { Badge } from './ui/Badge.tsx';

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

const CATEGORY_BADGE_VARIANTS: Record<string, 'primary' | 'warning' | 'purple' | 'success' | 'danger' | 'cyan' | 'default'> = {
  source: 'primary',
  test: 'warning',
  config: 'purple',
  doc: 'success',
  asset: 'danger',
  ci: 'cyan',
  other: 'default',
};

interface TreeNodeItemProps {
  node: TreeNode;
  level: number;
  selectedPath?: string;
  onSelectFile?: (_file: FileTreeItem) => void;
}

const TreeNodeItem: React.FC<TreeNodeItemProps> = ({
  node,
  level,
  selectedPath,
  onSelectFile,
}) => {
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
      <div role="treeitem" aria-expanded={isOpen}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          style={{ paddingLeft: `${level * 14 + 6}px` }}
          className="w-full flex items-center gap-1.5 py-1 px-2 hover:bg-slate-800/70 rounded-md cursor-pointer text-xs text-slate-300 hover:text-white transition select-none text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
        >
          <span className="text-slate-500 hover:text-slate-300 transition">
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          {isOpen ? (
            <FolderOpen size={14} className="text-amber-400 shrink-0" />
          ) : (
            <Folder size={14} className="text-amber-400/80 shrink-0" />
          )}
          <span className="font-mono font-medium text-slate-200 text-xs truncate">
            {node.name}
          </span>
        </button>

        {isOpen && (
          <div role="group">
            {childEntries.map(([childName, childNode]) => (
              <TreeNodeItem
                key={childName}
                node={childNode}
                level={level + 1}
                selectedPath={selectedPath}
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
  const isSelected = selectedPath === item.path;
  const badgeVariant = CATEGORY_BADGE_VARIANTS[item.category] || 'default';

  return (
    <div role="treeitem">
      <button
        type="button"
        onClick={() => onSelectFile && onSelectFile(item)}
        style={{ paddingLeft: `${level * 14 + 20}px` }}
        className={`w-full flex items-center justify-between py-1 px-2 rounded-md cursor-pointer text-xs transition group text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 ${
          isSelected
            ? 'bg-blue-600/20 text-white font-medium border border-blue-500/30'
            : 'hover:bg-slate-800/80 text-slate-300 hover:text-white'
        }`}
      >
        <div className="flex items-center gap-2 truncate pr-2">
          <FileText
            size={13}
            className={`shrink-0 ${isSelected ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-400'}`}
          />
          <span
            className={`font-mono truncate ${
              isSelected ? 'text-blue-300' : 'group-hover:text-blue-400 transition-colors'
            }`}
          >
            {node.name}
          </span>
          {item.isLandmark && (
            <span title="Key Repository Landmark" className="inline-flex">
              <Star
                size={11}
                className="text-amber-400 shrink-0 fill-amber-400/30"
              />
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-auto font-mono text-[10px]">
          <Badge variant={badgeVariant} size="xs" mono>
            {item.category}
          </Badge>
          <span className="text-slate-500 text-[11px] w-14 text-right">
            {(item.size / 1024).toFixed(1)} KB
          </span>
        </div>
      </button>
    </div>
  );
};

export const FileTreeExplorer: React.FC<FileTreeExplorerProps> = ({ tree, onSelectFile }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | undefined>();

  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return tree;
    const term = searchTerm.toLowerCase();
    return tree.filter(
      (item) => item.path.toLowerCase().includes(term) || item.name.toLowerCase().includes(term)
    );
  }, [tree, searchTerm]);

  const treeRoot = useMemo(() => buildTreeStructure(filteredItems), [filteredItems]);

  const handleSelectFile = (file: FileTreeItem) => {
    setSelectedPath(file.path);
    onSelectFile?.(file);
  };

  return (
    <Card variant="default">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <CardTitle>
              <FileCode size={16} className="text-blue-400" />
              Repository File Tree
            </CardTitle>
            <span className="text-xs text-slate-500">
              ({filteredItems.length} of {tree.length} files)
            </span>
          </div>

          {/* Search Filter Input */}
          <div className="relative w-full sm:w-72">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Filter file path..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Filter repository files"
              className="w-full pl-8 pr-7 py-1.5 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5 rounded"
                title="Clear filter"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-3">
        {filteredItems.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 bg-slate-950/60 rounded-xl border border-slate-800/80">
            No files match &ldquo;{searchTerm}&rdquo;. Try a different keyword or path segment.
          </div>
        ) : (
          <div
            role="tree"
            aria-label="File tree navigation"
            className="max-h-[550px] overflow-y-auto pr-1 border border-slate-800/80 rounded-xl p-2 bg-slate-950/80"
          >
            {Object.entries(treeRoot.children).map(([name, node]) => (
              <TreeNodeItem
                key={name}
                node={node}
                level={0}
                selectedPath={selectedPath}
                onSelectFile={handleSelectFile}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

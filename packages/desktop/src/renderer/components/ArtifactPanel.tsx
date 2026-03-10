import React, { useState } from 'react';
import { File, Folder, ChevronRight, ChevronDown, Code, FileText, Image, X } from 'lucide-react';

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  artifact?: {
    id: string;
    type: string;
    size: number;
    updatedAt: number;
  };
}

interface ArtifactPanelProps {
  artifacts: FileTreeNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  fileContent: string | null;
  onClose: () => void;
}

export function ArtifactPanel({ artifacts, selectedPath, onSelectFile, fileContent, onClose }: ArtifactPanelProps) {
  return (
    <div className="flex flex-col h-full border-l border-[var(--color-border)] bg-[var(--color-bg)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <span className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
          Artifacts
        </span>
        <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-bg-tertiary)]">
          <X size={14} className="text-[var(--color-text-muted)]" />
        </button>
      </div>

      {/* File Tree */}
      <div className="flex-shrink-0 max-h-48 overflow-y-auto border-b border-[var(--color-border)] p-2">
        {artifacts.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)] text-center py-4">No artifacts yet</p>
        ) : (
          <div className="space-y-0.5">
            {artifacts.map((node) => (
              <TreeNode key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={onSelectFile} />
            ))}
          </div>
        )}
      </div>

      {/* Content Preview */}
      <div className="flex-1 overflow-auto p-3">
        {selectedPath && fileContent !== null ? (
          <pre className="text-xs font-mono text-[var(--color-text)] whitespace-pre-wrap break-words">
            {fileContent}
          </pre>
        ) : selectedPath ? (
          <p className="text-xs text-[var(--color-text-muted)] text-center py-8">Loading...</p>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)] text-center py-8">
            Select a file to preview
          </p>
        )}
      </div>
    </div>
  );
}

function TreeNode({ node, depth, selectedPath, onSelect }: {
  node: FileTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = node.path === selectedPath;

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-1.5 px-1 py-0.5 rounded text-xs hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          <Folder size={12} className="text-yellow-500" />
          <span>{node.name}</span>
        </button>
        {expanded && node.children?.map((child) => (
          <TreeNode key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  const icon = node.artifact?.type === 'image' ? <Image size={12} className="text-purple-400" />
    : node.artifact?.type === 'code' ? <Code size={12} className="text-blue-400" />
    : <FileText size={12} className="text-[var(--color-text-muted)]" />;

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`w-full flex items-center gap-1.5 px-1 py-0.5 rounded text-xs transition-colors ${
        isSelected
          ? 'bg-[var(--color-primary)] text-white'
          : 'hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]'
      }`}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
    >
      {icon}
      <span className="truncate">{node.name}</span>
    </button>
  );
}

import React, { useState } from 'react';
import { File, Folder, ChevronRight, ChevronDown, Code, FileText, Image, X, Layers } from 'lucide-react';

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
    <div
      className="flex flex-col h-full"
      style={{
        borderLeft: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5"
        style={{
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-secondary)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <div className="flex items-center gap-2">
          <Layers size={13} style={{ color: 'var(--color-primary)' }} />
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Artifacts
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-muted)';
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* File Tree */}
      <div
        className="flex-shrink-0 max-h-52 overflow-y-auto p-2"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        {artifacts.length === 0 ? (
          <div className="py-6 text-center">
            <File size={24} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)', opacity: 0.4 }} />
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>No artifacts yet</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {artifacts.map((node) => (
              <TreeNode key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={onSelectFile} />
            ))}
          </div>
        )}
      </div>

      {/* Content Preview */}
      <div className="flex-1 overflow-auto">
        {selectedPath && fileContent !== null ? (
          <div className="h-full flex flex-col">
            {/* File path header */}
            <div
              className="px-3 py-1.5 text-xs truncate"
              style={{
                borderBottom: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
                background: 'var(--color-bg-secondary)',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {selectedPath}
            </div>
            {/* Content with line numbers feel */}
            <div className="flex-1 overflow-auto p-0">
              <pre
                className="text-xs whitespace-pre-wrap break-words p-3 h-full"
                style={{
                  color: 'var(--color-text)',
                  fontFamily: 'JetBrains Mono, monospace',
                  lineHeight: '1.6',
                  background: 'var(--color-bg)',
                }}
              >
                {fileContent}
              </pre>
            </div>
          </div>
        ) : selectedPath ? (
          <div className="py-10 text-center">
            <div
              className="inline-block w-5 h-5 rounded-full animate-pulse mb-2"
              style={{ background: 'var(--color-border)' }}
            />
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
          </div>
        ) : (
          <div className="py-10 text-center px-4">
            <FileText size={24} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)', opacity: 0.3 }} />
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Select a file to preview
            </p>
          </div>
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
          className="w-full flex items-center gap-1.5 py-1 rounded-lg text-xs transition-colors"
          style={{
            paddingLeft: `${depth * 14 + 6}px`,
            color: 'var(--color-text-secondary)',
            background: 'transparent',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          }}
        >
          {/* Indentation guide line */}
          {depth > 0 && (
            <span
              className="absolute"
              style={{
                left: `${depth * 14 - 2}px`,
                width: '1px',
                top: 0,
                bottom: 0,
                background: 'var(--color-border)',
              }}
            />
          )}
          {expanded ? (
            <ChevronDown size={10} style={{ flexShrink: 0 }} />
          ) : (
            <ChevronRight size={10} style={{ flexShrink: 0 }} />
          )}
          <Folder size={12} style={{ color: '#f59e0b', flexShrink: 0 }} />
          <span>{node.name}</span>
        </button>
        {expanded && node.children?.map((child) => (
          <TreeNode key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  const icon =
    node.artifact?.type === 'image' ? (
      <Image size={12} style={{ color: '#a78bfa', flexShrink: 0 }} />
    ) : node.artifact?.type === 'code' ? (
      <Code size={12} style={{ color: '#60a5fa', flexShrink: 0 }} />
    ) : (
      <FileText size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
    );

  return (
    <button
      onClick={() => onSelect(node.path)}
      className="w-full flex items-center gap-1.5 py-1 rounded-lg text-xs transition-all"
      style={{
        paddingLeft: `${depth * 14 + 6}px`,
        background: isSelected ? 'rgba(6,214,160,0.12)' : 'transparent',
        color: isSelected ? 'var(--color-primary)' : 'var(--color-text-secondary)',
        border: isSelected ? '1px solid var(--color-border-accent)' : '1px solid transparent',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }
      }}
    >
      {icon}
      <span className="truncate">{node.name}</span>
    </button>
  );
}

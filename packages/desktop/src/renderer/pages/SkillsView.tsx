import React, { useEffect, useState } from 'react';
import { Zap, Plus, RefreshCw, Trash2, Download } from 'lucide-react';

interface SkillInfo {
  name: string;
  path: string;
  description?: string;
}

export function SkillsView() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [genDesc, setGenDesc] = useState('');
  const [installName, setInstallName] = useState('');
  const [installContent, setInstallContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [mode, setMode] = useState<'list' | 'install' | 'generate'>('list');

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    try {
      const result = await window.jarvis.skills.list();
      setSkills(result || []);
    } catch { /* ignore */ }
  };

  const handleGenerate = async () => {
    if (!genDesc.trim()) return;
    setIsGenerating(true);
    try {
      await window.jarvis.skills.generate(genDesc);
      setGenDesc('');
      setMode('list');
      await loadSkills();
    } catch (err) {
      console.error('Failed to generate skill:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleInstall = async () => {
    if (!installName.trim() || !installContent.trim()) return;
    try {
      await window.jarvis.skills.install(installName, installContent);
      setInstallName('');
      setInstallContent('');
      setMode('list');
      await loadSkills();
    } catch (err) {
      console.error('Failed to install skill:', err);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Claude Code Skills</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setMode('generate')}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)]"
          >
            <Zap size={14} /> Generate
          </button>
          <button
            onClick={() => setMode('install')}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--color-bg-tertiary)] text-sm hover:bg-[var(--color-border)]"
          >
            <Download size={14} /> Install
          </button>
          <button onClick={loadSkills} className="p-1.5 rounded-lg hover:bg-[var(--color-bg-tertiary)]">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Generate Skill */}
      {mode === 'generate' && (
        <section className="mb-6 p-4 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
          <h3 className="text-sm font-semibold mb-3">Generate Skill from Description</h3>
          <textarea
            value={genDesc}
            onChange={(e) => setGenDesc(e.target.value)}
            placeholder="Describe the CC skill... e.g., 'A skill that reviews code for security vulnerabilities'"
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm outline-none focus:border-[var(--color-primary)] resize-none mb-3"
          />
          <div className="flex gap-2">
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !genDesc.trim()}
              className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-40"
            >
              {isGenerating ? 'Generating...' : 'Generate'}
            </button>
            <button
              onClick={() => setMode('list')}
              className="px-4 py-2 rounded-lg bg-[var(--color-bg-tertiary)] text-sm hover:bg-[var(--color-border)]"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Install Skill */}
      {mode === 'install' && (
        <section className="mb-6 p-4 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
          <h3 className="text-sm font-semibold mb-3">Install Skill Manually</h3>
          <input
            value={installName}
            onChange={(e) => setInstallName(e.target.value)}
            placeholder="Skill name (e.g., review-security)"
            className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm outline-none focus:border-[var(--color-primary)] mb-3"
          />
          <textarea
            value={installContent}
            onChange={(e) => setInstallContent(e.target.value)}
            placeholder="Skill content (markdown)..."
            rows={8}
            className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm outline-none focus:border-[var(--color-primary)] resize-none mb-3 font-mono"
          />
          <div className="flex gap-2">
            <button
              onClick={handleInstall}
              disabled={!installName.trim() || !installContent.trim()}
              className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-40"
            >
              Install
            </button>
            <button
              onClick={() => setMode('list')}
              className="px-4 py-2 rounded-lg bg-[var(--color-bg-tertiary)] text-sm hover:bg-[var(--color-border)]"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Skill List */}
      <div className="space-y-2">
        {skills.map((skill) => (
          <div
            key={skill.name}
            className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]"
          >
            <Zap size={16} className="text-[var(--color-warning)] shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium">/{skill.name}</span>
              {skill.description && (
                <p className="text-xs text-[var(--color-text-muted)] truncate">{skill.description}</p>
              )}
            </div>
            <span className="text-[10px] text-[var(--color-text-muted)] font-mono truncate max-w-40">
              {skill.path}
            </span>
          </div>
        ))}

        {skills.length === 0 && (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-8">
            No CC skills installed. Generate or install skills to extend Claude Code's capabilities.
          </p>
        )}
      </div>
    </div>
  );
}

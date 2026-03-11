import React, { useEffect, useState } from 'react';
import { Zap, Plus, RefreshCw, Download } from 'lucide-react';
import { api } from '../api';

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
      const result = await api.skills.list();
      setSkills(result || []);
    } catch { /* ignore */ }
  };

  const handleGenerate = async () => {
    if (!genDesc.trim()) return;
    setIsGenerating(true);
    try {
      await api.skills.generate(genDesc);
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
      await api.skills.install(installName, installContent);
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
      {/* 页面标题 */}
      <div className="mb-8 animate-fadeInUp">
        <h2 className="text-2xl font-bold text-gradient mb-1">Claude Code Skills</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Extend Claude Code's capabilities with custom skills
        </p>
      </div>

      {/* 操作按钮区 */}
      <div className="flex gap-2 mb-6 animate-fadeInUp" style={{ animationDelay: '0.05s' }}>
        <button
          onClick={() => setMode(mode === 'generate' ? 'list' : 'generate')}
          className={`btn ${mode === 'generate' ? 'btn-primary' : 'btn-ghost'} flex items-center gap-1.5 px-3 py-1.5`}
        >
          <Zap size={13} />
          <span className="text-sm">Generate</span>
        </button>
        <button
          onClick={() => setMode(mode === 'install' ? 'list' : 'install')}
          className={`btn ${mode === 'install' ? 'btn-primary' : 'btn-ghost'} flex items-center gap-1.5 px-3 py-1.5`}
        >
          <Download size={13} />
          <span className="text-sm">Install</span>
        </button>
        <button
          onClick={loadSkills}
          className="btn btn-ghost p-1.5"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* 生成 Skill 面板 */}
      {mode === 'generate' && (
        <section className="card-glow p-5 mb-6 animate-fadeInUp">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-[var(--color-text)]">
            <Zap size={14} className="text-[var(--color-primary)]" />
            Generate Skill from Description
          </h3>
          <textarea
            value={genDesc}
            onChange={(e) => setGenDesc(e.target.value)}
            placeholder="Describe the CC skill... e.g., 'A skill that reviews code for security vulnerabilities'"
            rows={3}
            className="input w-full mb-3"
            style={{ resize: 'none' }}
            disabled={isGenerating}
          />
          {isGenerating && (
            <div className="mb-3 space-y-2">
              <div className="skeleton" style={{ height: '0.75rem', width: '60%' }} />
              <div className="skeleton" style={{ height: '0.75rem', width: '40%' }} />
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !genDesc.trim()}
              className="btn btn-primary px-4 py-1.5"
            >
              {isGenerating ? (
                <>
                  <RefreshCw size={13} className="animate-spin mr-1.5" />
                  Generating...
                </>
              ) : (
                'Generate'
              )}
            </button>
            <button
              onClick={() => setMode('list')}
              className="btn btn-ghost px-4 py-1.5"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* 手动安装 Skill 面板 */}
      {mode === 'install' && (
        <section className="card-glow p-5 mb-6 animate-fadeInUp">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-[var(--color-text)]">
            <Download size={14} className="text-[var(--color-primary)]" />
            Install Skill Manually
          </h3>
          <input
            value={installName}
            onChange={(e) => setInstallName(e.target.value)}
            placeholder="Skill name (e.g., review-security)"
            className="input w-full mb-3"
          />
          <textarea
            value={installContent}
            onChange={(e) => setInstallContent(e.target.value)}
            placeholder="Skill content (markdown)..."
            rows={8}
            className="input w-full mb-3 font-mono"
            style={{ resize: 'none', fontFamily: 'var(--font-mono)' }}
          />
          <div className="flex gap-2">
            <button
              onClick={handleInstall}
              disabled={!installName.trim() || !installContent.trim()}
              className="btn btn-primary px-4 py-1.5"
            >
              Install
            </button>
            <button
              onClick={() => setMode('list')}
              className="btn btn-ghost px-4 py-1.5"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Skill 列表 */}
      <div className="space-y-2">
        {skills.map((skill, index) => (
          <div
            key={skill.name}
            className="card-glow p-3.5 animate-fadeInUp"
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--color-bg-tertiary)] flex items-center justify-center shrink-0">
                <Zap size={14} className="text-[var(--color-primary)]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-[var(--color-text)]">/{skill.name}</span>
                  {/* 路径徽章：用 Tailwind 类替代内联 fontFamily/fontSize */}
                  <span className="badge font-mono text-[10px] max-w-[10rem] overflow-hidden text-ellipsis whitespace-nowrap">
                    {skill.path}
                  </span>
                </div>
                {skill.description && (
                  <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">{skill.description}</p>
                )}
              </div>
            </div>
          </div>
        ))}

        {skills.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-[var(--color-bg-tertiary)] flex items-center justify-center mx-auto mb-4">
              <Zap size={24} className="text-[var(--color-text-muted)] opacity-40" />
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">No CC skills installed.</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 opacity-60">
              Generate or install skills to extend Claude Code's capabilities.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

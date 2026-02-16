import { useState, useEffect, type ReactElement } from 'react';

// Idea type from the database
interface Idea {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'completed' | 'archived';
}

// Props for the IdeasList component
interface IdeasListProps {
  onSelectIdea: (ideaId: string) => void;
  onNewIdea: () => void;
}

// Ideas list component - TRAE DeepBlue inspired design
// Guided by the Holy Spirit
export function IdeasList({ onSelectIdea, onNewIdea }: IdeasListProps): ReactElement {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Edit modal state
  const [editingIdea, setEditingIdea] = useState<Idea | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [backingUp, setBackingUp] = useState<boolean>(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);

  // Load ideas on mount
  useEffect(() => {
    loadIdeas();
  }, []);

  // Load all ideas from database
  const loadIdeas = async (): Promise<void> => {
    setLoading(true);
    const loadedIdeas = await window.electronAPI.ideas.getAll();
    setIdeas(loadedIdeas);
    setLoading(false);
  };

  // Delete an idea
  const deleteIdea = async (ideaId: string, event: React.MouseEvent): Promise<void> => {
    event.stopPropagation();
    await window.electronAPI.ideas.delete(ideaId);
    setIdeas(prevIdeas => prevIdeas.filter(i => i.id !== ideaId));
  };

  // Start editing an idea
  const startEditIdea = (idea: Idea, event: React.MouseEvent): void => {
    event.stopPropagation();
    setEditingIdea(idea);
    setEditTitle(idea.title);
  };

  // Save the edited title
  const saveEditIdea = async (): Promise<void> => {
    if (!editingIdea) return;

    const newTitle = editTitle.trim() || editingIdea.title;
    await window.electronAPI.ideas.update(editingIdea.id, { title: newTitle });

    // Update local state
    setIdeas(prevIdeas =>
      prevIdeas.map(i =>
        i.id === editingIdea.id ? { ...i, title: newTitle } : i
      )
    );

    setEditingIdea(null);
    setEditTitle('');
  };

  // Cancel editing
  const cancelEditIdea = (): void => {
    setEditingIdea(null);
    setEditTitle('');
  };

  // Create a full backup
  const handleBackup = async (): Promise<void> => {
    setBackingUp(true);
    setBackupMessage(null);
    try {
      const result = await window.electronAPI.backup.create();
      setBackupMessage('Backup created successfully');
      setTimeout(() => setBackupMessage(null), 4000);
    } catch (err) {
      setBackupMessage('Backup failed: ' + (err instanceof Error ? err.message : String(err)));
      setTimeout(() => setBackupMessage(null), 6000);
    } finally {
      setBackingUp(false);
    }
  };

  // Format date for display
  const formatDate = (date: Date): string => {
    return new Date(date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen flex flex-col p-8">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-light text-blue-50">
          Your Ideas
        </h1>

        <div className="flex items-center gap-3">
          {/* Backup status message */}
          {backupMessage && (
            <span className={`text-sm px-3 py-1 rounded-lg ${
              backupMessage.startsWith('Backup created')
                ? 'text-emerald-300 bg-emerald-900/30'
                : 'text-red-300 bg-red-900/30'
            }`}>
              {backupMessage}
            </span>
          )}

          {/* Backup button */}
          <button
            onClick={handleBackup}
            disabled={backingUp}
            className="flex items-center gap-2 px-4 py-2.5
                       border border-[#1e3a5f] hover:border-sky-500
                       text-blue-200 hover:text-sky-300 rounded-xl
                       transition-colors duration-200 disabled:opacity-50"
            title="Create full backup of database and all projects"
          >
            {backingUp ? (
              <div className="w-4 h-4 border-2 border-blue-300/30 border-t-sky-400 rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            )}
            <span>{backingUp ? 'Backing up...' : 'Backup'}</span>
          </button>

          {/* New Idea button */}
          <button
            onClick={onNewIdea}
            className="flex items-center gap-2 px-5 py-2.5
                       bg-sky-500 hover:bg-sky-400
                       text-white rounded-xl
                       transition-colors duration-200"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>New Idea</span>
          </button>
        </div>
      </header>

      {/* Ideas grid */}
      <div className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-[#1e3a5f] border-t-sky-400 rounded-full animate-spin" />
          </div>
        ) : ideas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-24 h-24 mb-6 rounded-full bg-[#112240] flex items-center justify-center">
              <svg className="w-12 h-12 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <p className="text-blue-100 mb-2">No ideas yet</p>
            <p className="text-blue-200/60 text-sm">Tap "New Idea" to capture your first thought</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {ideas.map((idea) => (
              <div
                key={idea.id}
                onClick={() => onSelectIdea(idea.id)}
                className="group relative p-5 bg-[#112240] rounded-2xl
                           border border-[#1e3a5f] hover:border-sky-500
                           transition-colors duration-200 cursor-pointer"
              >
                {/* Idea title */}
                <h3 className="text-lg font-medium text-blue-50 mb-2 truncate">
                  {idea.title}
                </h3>

                {/* Idea metadata */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-blue-200/60">
                    {formatDate(idea.updatedAt)}
                  </span>

                  {/* Status badge */}
                  <span className={`px-2 py-0.5 rounded-full text-xs
                    ${idea.status === 'active'
                      ? 'bg-sky-900/50 text-sky-300'
                      : idea.status === 'completed'
                        ? 'bg-emerald-900/50 text-emerald-300'
                        : 'bg-[#1e3a5f] text-blue-300/60'
                    }`}
                  >
                    {idea.status}
                  </span>
                </div>

                {/* Action buttons - visible on hover */}
                <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                  {/* Edit button */}
                  <button
                    onClick={(e) => startEditIdea(idea, e)}
                    className="p-1.5 rounded-lg bg-[#1e3a5f] hover:bg-sky-900/50
                               text-blue-300/60 hover:text-sky-400 transition-colors"
                    title="Edit title"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  {/* Delete button */}
                  <button
                    onClick={(e) => deleteIdea(idea.id, e)}
                    className="p-1.5 rounded-lg bg-[#1e3a5f] hover:bg-red-900/50
                               text-blue-300/60 hover:text-red-400 transition-colors"
                    title="Delete idea"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Idea Modal */}
      {editingIdea && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#112240] rounded-2xl border border-[#1e3a5f] p-6 w-full max-w-md mx-4 shadow-2xl">
            <h2 className="text-xl font-medium text-blue-50 mb-4">
              Rename Idea
            </h2>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEditIdea();
                if (e.key === 'Escape') cancelEditIdea();
              }}
              placeholder="Enter a new name..."
              autoFocus
              className="w-full px-4 py-3 bg-[#0a1628] border border-[#1e3a5f] rounded-xl
                         text-blue-50 placeholder-blue-300/40
                         focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                         transition-colors"
            />
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={cancelEditIdea}
                className="px-4 py-2 text-blue-300 hover:text-blue-100
                           hover:bg-[#1e3a5f] rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEditIdea}
                className="px-5 py-2 bg-sky-500 hover:bg-sky-400
                           text-white rounded-xl transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

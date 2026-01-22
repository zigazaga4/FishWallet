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

                {/* Delete button - visible on hover */}
                <button
                  onClick={(e) => deleteIdea(idea.id, e)}
                  className="absolute top-3 right-3 p-1.5 rounded-lg
                             opacity-0 group-hover:opacity-100
                             bg-[#1e3a5f] hover:bg-red-900/50
                             text-blue-300/60 hover:text-red-400
                             transition-all duration-200"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, type ReactElement } from 'react';
import { HomeCanvas } from './components/HomeCanvas';
import { IdeasList } from './components/IdeasList';
import { IdeaRecorder } from './components/IdeaRecorder';
import { IdeaChat } from './components/IdeaChat';

// View states for the application
type AppView = 'home' | 'ideas' | 'recording' | 'chat';

// Main application component
export function App(): ReactElement {
  const [currentView, setCurrentView] = useState<AppView>('home');
  const [currentIdeaId, setCurrentIdeaId] = useState<string | null>(null);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [isNewConversation, setIsNewConversation] = useState<boolean>(false);
  const [hasIdeas, setHasIdeas] = useState<boolean>(false);

  // New idea modal state
  const [showNewIdeaModal, setShowNewIdeaModal] = useState<boolean>(false);
  const [newIdeaName, setNewIdeaName] = useState<string>('');

  // Check if there are existing ideas on mount
  useEffect(() => {
    checkForExistingIdeas();
  }, []);

  // Dev keyboard shortcut: Ctrl+Shift+D to seed database
  const handleDevKeyboard = useCallback(async (event: KeyboardEvent): Promise<void> => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      alert('Seeding database with test data...');
      const result = await window.electronAPI.dev.seed();
      alert(`Seeded: ${result.ideas} ideas, ${result.notes} notes`);
      // Refresh the view
      await checkForExistingIdeas();
    }
  }, []);

  // Register dev keyboard shortcut
  useEffect(() => {
    window.addEventListener('keydown', handleDevKeyboard);
    return () => window.removeEventListener('keydown', handleDevKeyboard);
  }, [handleDevKeyboard]);

  // Check if user has any ideas
  const checkForExistingIdeas = async (): Promise<void> => {
    const ideas = await window.electronAPI.ideas.getAll();
    setHasIdeas(ideas.length > 0);
    if (ideas.length > 0) {
      setCurrentView('ideas');
    }
  };

  // Handle starting a new idea - show modal to enter name
  const handleStartIdea = (): void => {
    setNewIdeaName('');
    setShowNewIdeaModal(true);
  };

  // Actually create the idea with the entered name
  const handleCreateIdea = async (): Promise<void> => {
    const title = newIdeaName.trim() || `Idea - ${new Date().toLocaleDateString()}`;
    const idea = await window.electronAPI.ideas.create({ title });
    setCurrentIdeaId(idea.id);
    setShowNewIdeaModal(false);
    setNewIdeaName('');
    setCurrentView('recording');
  };

  // Cancel creating a new idea
  const handleCancelNewIdea = (): void => {
    setShowNewIdeaModal(false);
    setNewIdeaName('');
  };

  // Handle selecting an existing idea
  const handleSelectIdea = (ideaId: string): void => {
    setCurrentIdeaId(ideaId);
    setCurrentView('recording');
  };

  // Handle going back from recording
  const handleBackFromRecording = (): void => {
    setCurrentView('ideas');
    setCurrentIdeaId(null);
    setHasIdeas(true);
  };

  // Handle going to ideas list from home
  const handleGoToIdeas = (): void => {
    setCurrentView('ideas');
  };

  // Handle opening chat from recording
  const handleOpenChat = (ideaId: string, conversationId: string, isNew: boolean = true): void => {
    setCurrentIdeaId(ideaId);
    setCurrentConversationId(conversationId);
    setIsNewConversation(isNew);
    setCurrentView('chat');
  };

  // Handle going back from chat to recording
  const handleBackFromChat = (): void => {
    setCurrentView('recording');
    setCurrentConversationId(null);
    setIsNewConversation(false);
  };

  return (
    <div className="min-h-screen bg-[#0a1628]">
      {currentView === 'home' && (
        <HomeCanvas
          onStartIdea={handleStartIdea}
          onViewIdeas={hasIdeas ? handleGoToIdeas : undefined}
        />
      )}
      {currentView === 'ideas' && (
        <IdeasList
          onSelectIdea={handleSelectIdea}
          onNewIdea={handleStartIdea}
        />
      )}
      {currentView === 'recording' && currentIdeaId && (
        <IdeaRecorder
          ideaId={currentIdeaId}
          onBack={handleBackFromRecording}
          onOpenChat={handleOpenChat}
        />
      )}
      {currentView === 'chat' && currentIdeaId && currentConversationId && (
        <IdeaChat
          ideaId={currentIdeaId}
          conversationId={currentConversationId}
          isNewConversation={isNewConversation}
          onBack={handleBackFromChat}
        />
      )}

      {/* New Idea Modal */}
      {showNewIdeaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#112240] rounded-2xl border border-[#1e3a5f] p-6 w-full max-w-md mx-4 shadow-2xl">
            <h2 className="text-xl font-medium text-blue-50 mb-4">
              Name Your Idea
            </h2>
            <input
              type="text"
              value={newIdeaName}
              onChange={(e) => setNewIdeaName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateIdea();
                if (e.key === 'Escape') handleCancelNewIdea();
              }}
              placeholder="Enter a name for your idea..."
              autoFocus
              className="w-full px-4 py-3 bg-[#0a1628] border border-[#1e3a5f] rounded-xl
                         text-blue-50 placeholder-blue-300/40
                         focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                         transition-colors"
            />
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={handleCancelNewIdea}
                className="px-4 py-2 text-blue-300 hover:text-blue-100
                           hover:bg-[#1e3a5f] rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateIdea}
                className="px-5 py-2 bg-sky-500 hover:bg-sky-400
                           text-white rounded-xl transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

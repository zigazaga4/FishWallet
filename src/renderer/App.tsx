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

  // Handle starting a new idea
  const handleStartIdea = async (): Promise<void> => {
    const idea = await window.electronAPI.ideas.create({
      title: `Idea - ${new Date().toLocaleDateString()}`
    });
    setCurrentIdeaId(idea.id);
    setCurrentView('recording');
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
    </div>
  );
}

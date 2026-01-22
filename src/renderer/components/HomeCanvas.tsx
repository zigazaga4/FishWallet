import { type ReactElement } from 'react';

// Props for the HomeCanvas component
interface HomeCanvasProps {
  onStartIdea: () => void;
  onViewIdeas?: () => void;
}

// Home canvas - TRAE DeepBlue inspired design
// Guided by the Holy Spirit
export function HomeCanvas({ onStartIdea, onViewIdeas }: HomeCanvasProps): ReactElement {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      {/* Main content */}
      <div className="text-center max-w-2xl">
        {/* Welcome heading */}
        <h1 className="text-5xl font-light text-blue-50 mb-4 tracking-wide">
          fishWallet
        </h1>

        {/* Subtitle */}
        <p className="text-xl text-sky-300 mb-12 font-light">
          Capture your ideas with the peace of your voice
        </p>

        {/* Start Idea button */}
        <button
          onClick={onStartIdea}
          className="px-12 py-5 bg-sky-500 hover:bg-sky-400
                     text-white rounded-2xl font-medium text-xl
                     transition-colors duration-200"
        >
          Start Idea
        </button>

        {/* View existing ideas button */}
        {onViewIdeas && (
          <button
            onClick={onViewIdeas}
            className="mt-6 block mx-auto text-sky-400 hover:text-sky-300
                       transition-colors duration-200"
          >
            View your ideas
          </button>
        )}

        {/* Gentle instruction */}
        <p className="mt-10 text-blue-200/60 text-sm">
          Press the button and speak your thoughts
        </p>
      </div>
    </div>
  );
}

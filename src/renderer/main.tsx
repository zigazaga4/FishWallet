import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/index.css';

// Get the root element from the DOM
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found in DOM');
}

// Create React root and render the application
const root = createRoot(rootElement);

root.render(
  <StrictMode>
    <App />
  </StrictMode>
);

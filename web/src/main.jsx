import React from 'react';
import { createRoot } from 'react-dom/client';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import App from './App.jsx';
import './styles.css';

ModuleRegistry.registerModules([AllCommunityModule]);

// Let AG Grid's variable colour scheme follow the OS theme.
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const applyMode = () => (document.body.dataset.agThemeMode = mq.matches ? 'dark' : 'light');
applyMode();
mq.addEventListener('change', applyMode);

createRoot(document.getElementById('root')).render(<App />);

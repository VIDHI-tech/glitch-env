import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
function App(){return <main><header><strong>GLITCH<span>•</span></strong><small>Learning platform foundation</small></header><section><p className="eyebrow">Engineering migration in progress</p><h1>Your learning space is being upgraded.</h1><p>The current student application remains available while the new platform is built and verified.</p><a href="http://127.0.0.1:3000">Open the current GLITCH app →</a></section></main>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

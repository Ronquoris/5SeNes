import { useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { SkipLink } from './components/SkipLink';
import { LiveRegion } from './components/LiveRegion';
import { FloatingHoldToSpeakButton } from './components/FloatingHoldToSpeakButton';
import { NavigatePage } from './pages/NavigatePage';
import { NearbyPage } from './pages/NearbyPage';
import { HazardsPage } from './pages/HazardsPage';
import { SosPage } from './pages/SosPage';
import { SosSharePage } from './pages/SosSharePage';
import { unlockAudio } from './services/audioFeedback';

export default function App() {
  useEffect(() => {
    function handleFirstInteraction() {
      unlockAudio();
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    }
    window.addEventListener('pointerdown', handleFirstInteraction, { passive: true });
    window.addEventListener('touchstart', handleFirstInteraction, { passive: true });
    window.addEventListener('keydown', handleFirstInteraction, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };
  }, []);

  return (
    <>
      <SkipLink />
      <header className="app-header">
        <h1>5Sense</h1>
        <p className="subtitle">Accessible navigation for Manchester</p>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/nearby">Nearby</NavLink>
          <NavLink to="/hazards">Hazards</NavLink>
          <NavLink to="/sos">SOS</NavLink>
        </nav>
      </header>

      <LiveRegion />

      <main id="main" style={{ paddingBottom: '96px' }}>
        <Routes>
          <Route path="/" element={<NavigatePage />} />
          <Route path="/navigate" element={<NavigatePage />} />
          <Route path="/nearby" element={<NearbyPage />} />
          <Route path="/hazards" element={<HazardsPage />} />
          <Route path="/sos" element={<SosPage />} />
          <Route path="/share/:sessionId" element={<SosSharePage />} />
        </Routes>
      </main>

      {/* Global Floating Hold & Speak Button across the entire application */}
      <FloatingHoldToSpeakButton />
    </>
  );
}

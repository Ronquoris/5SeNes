import { useState } from 'react';
import type { RouteResponse, RouteStep } from '../api/client';
import { speechQueue } from '../speech/SpeechQueue';

interface RouteNarratorProps {
  route: RouteResponse;
}

function stepAnnouncement(step: RouteStep): { text: string; priority: 'CRITICAL' | 'NAVIGATION' } {
  if (step.hazardWarnings.length > 0) {
    const warning = step.hazardWarnings[0];
    const hazardLabel = warning.type.replace(/_/g, ' ');
    return {
      text: `Caution, ${hazardLabel} reported ${warning.distanceFromStepMeters} metres ahead. Then: ${step.instruction}.`,
      priority: 'CRITICAL',
    };
  }
  return { text: `${step.instruction}, ${step.distanceMeters} metres.`, priority: 'NAVIGATION' };
}

export function RouteNarrator({ route }: RouteNarratorProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentStep = route.steps[currentIndex];

  function goTo(index: number) {
    if (index < 0 || index >= route.steps.length) return;
    setCurrentIndex(index);
    const { text, priority } = stepAnnouncement(route.steps[index]);
    speechQueue.speak(text, priority);
  }

  function repeat() {
    const { text, priority } = stepAnnouncement(currentStep);
    speechQueue.speak(text, priority);
  }

  return (
    <div className="card">
      <h2>Directions</h2>
      <p className="muted">
        {(route.distanceMeters / 1000).toFixed(2)} km · about {Math.round(route.durationSeconds / 60)} min walking
      </p>

      <div className="row" style={{ margin: '0.75rem 0' }}>
        <button className="btn secondary" onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === 0}>
          ◀ Previous step
        </button>
        <button className="btn" onClick={repeat}>
          🔊 Repeat step {currentIndex + 1} of {route.steps.length}
        </button>
        <button
          className="btn secondary"
          onClick={() => goTo(currentIndex + 1)}
          disabled={currentIndex === route.steps.length - 1}
        >
          Next step ▶
        </button>
      </div>

      <ol className="list-unstyled" aria-label="Full turn-by-turn directions">
        {route.steps.map((step, index) => (
          <li
            key={step.index}
            className="list-item"
            style={index === currentIndex ? { outline: '2px solid var(--focus)' } : undefined}
          >
            <strong>{index + 1}.</strong> {step.instruction} — {step.distanceMeters} m
            {step.hazardWarnings.length > 0 && (
              <div className="error-text">
                ⚠ {step.hazardWarnings[0].type.replace(/_/g, ' ')} reported {step.hazardWarnings[0].distanceFromStepMeters} m
                away
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

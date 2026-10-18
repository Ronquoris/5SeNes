import { FormEvent, useEffect, useState } from 'react';
import { geocodeSearch, type GeocodeResult } from '../api/client';
import { useSpeechRecognition } from '../speech/useSpeechRecognition';
import { speechQueue } from '../speech/SpeechQueue';

interface SearchBarProps {
  onSelectDestination: (result: GeocodeResult) => void;
}

export function SearchBar({ onSelectDestination }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { supported, isListening, transcript, start, error: speechError } = useSpeechRecognition();

  useEffect(() => {
    if (transcript) {
      setQuery(transcript);
      void runSearch(transcript);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript]);

  useEffect(() => {
    if (speechError) {
      speechQueue.speak('Could not hear that, please try again or type instead.', 'INFO');
    }
  }, [speechError]);

  async function runSearch(text: string) {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { results } = await geocodeSearch(text);
      setResults(results);
      if (results.length === 0) {
        speechQueue.speak(`No results found for ${text}.`, 'INFO');
      } else {
        speechQueue.speak(`${results.length} result${results.length === 1 ? '' : 's'} found. ${results[0].label}`, 'INFO');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed.';
      setError(message);
      speechQueue.speak(message, 'INFO');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void runSearch(query);
  }

  return (
    <div className="card">
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="destination-search">Where do you want to go?</label>
          <div className="row">
            <input
              id="destination-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Manchester Museum"
              style={{ flex: 1, minWidth: '200px' }}
            />
            <button type="submit" className="btn" disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </button>
            {supported && (
              <button
                type="button"
                className="btn secondary"
                onClick={start}
                aria-pressed={isListening}
                disabled={isListening}
              >
                {isListening ? 'Listening…' : '🎙 Voice search'}
              </button>
            )}
          </div>
        </div>
      </form>

      {error && <p className="error-text">{error}</p>}

      {results.length > 0 && (
        <ul className="list-unstyled" aria-label="Search results">
          {results.map((result) => (
            <li key={result.osmId} className="list-item">
              <button
                type="button"
                className="btn secondary"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => {
                  onSelectDestination(result);
                }}
              >
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

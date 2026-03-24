import { describe, it, expect } from 'vitest';
import {
  buildExtractionSystemPrompt,
  buildExtractionPrompt,
  PROMPT_VERSION,
} from '../../src/extraction/prompts.js';

describe('PROMPT_VERSION', () => {
  it('should be a non-empty string', () => {
    expect(PROMPT_VERSION).toBe('v1');
  });
});

describe('buildExtractionSystemPrompt', () => {
  it('should contain fact extraction rules', () => {
    const prompt = buildExtractionSystemPrompt();

    expect(prompt).toContain('fact extraction engine');
    expect(prompt).toContain('atomic facts');
  });

  it('should describe all memory types', () => {
    const prompt = buildExtractionSystemPrompt();

    expect(prompt).toContain('"fact"');
    expect(prompt).toContain('"preference"');
    expect(prompt).toContain('"decision"');
    expect(prompt).toContain('"event"');
  });

  it('should describe confidence levels', () => {
    const prompt = buildExtractionSystemPrompt();

    expect(prompt).toContain('0.9-1.0');
    expect(prompt).toContain('0.7-0.8');
    expect(prompt).toContain('0.5-0.6');
  });

  it('should request JSON output format', () => {
    const prompt = buildExtractionSystemPrompt();

    expect(prompt).toContain('{ "facts": [...] }');
  });

  it('should mention subject entity extraction', () => {
    const prompt = buildExtractionSystemPrompt();

    expect(prompt).toContain('subject entity');
  });

  it('should mention keyword extraction', () => {
    const prompt = buildExtractionSystemPrompt();

    expect(prompt).toContain('keywords');
  });
});

describe('buildExtractionPrompt', () => {
  it('should include conversation text', () => {
    const turns = [
      { speaker: 'Alice', text: 'I love hiking in the mountains.' },
      { speaker: 'Bob', text: 'Where do you usually go?' },
    ];

    const prompt = buildExtractionPrompt(turns, {});

    expect(prompt).toContain('Alice: I love hiking in the mountains.');
    expect(prompt).toContain('Bob: Where do you usually go?');
  });

  it('should include dateTime when provided', () => {
    const turns = [{ speaker: 'A', text: 'Hello' }];
    const context = { dateTime: '2024-03-15T10:00:00' };

    const prompt = buildExtractionPrompt(turns, context);

    expect(prompt).toContain('Conversation date: 2024-03-15T10:00:00');
  });

  it('should include participants when both provided', () => {
    const turns = [{ speaker: 'A', text: 'Hello' }];
    const context = { speakerA: 'Alice', speakerB: 'Bob' };

    const prompt = buildExtractionPrompt(turns, context);

    expect(prompt).toContain('Participants: Alice, Bob');
  });

  it('should not include participants when only one provided', () => {
    const turns = [{ speaker: 'A', text: 'Hello' }];
    const context = { speakerA: 'Alice' };

    const prompt = buildExtractionPrompt(turns, context);

    expect(prompt).not.toContain('Participants:');
  });

  it('should include session number when provided', () => {
    const turns = [{ speaker: 'A', text: 'Hello' }];
    const context = { sessionNumber: 5 };

    const prompt = buildExtractionPrompt(turns, context);

    expect(prompt).toContain('Session: 5');
  });

  it('should handle sessionNumber of 0', () => {
    const turns = [{ speaker: 'A', text: 'Hello' }];
    const context = { sessionNumber: 0 };

    const prompt = buildExtractionPrompt(turns, context);

    expect(prompt).toContain('Session: 0');
  });

  it('should handle empty context gracefully', () => {
    const turns = [{ speaker: 'A', text: 'Hello' }];

    const prompt = buildExtractionPrompt(turns, {});

    expect(prompt).not.toContain('Conversation date:');
    expect(prompt).not.toContain('Participants:');
    expect(prompt).not.toContain('Session:');
    expect(prompt).toContain('A: Hello');
  });

  it('should include extraction instruction at end', () => {
    const turns = [{ speaker: 'A', text: 'Hello' }];

    const prompt = buildExtractionPrompt(turns, {});

    expect(prompt).toContain('Extract all atomic facts');
    expect(prompt).toContain('{ "facts": [...] }');
  });

  it('should handle empty turns array', () => {
    const prompt = buildExtractionPrompt([], {});

    expect(prompt).toContain('Conversation:');
    expect(prompt).toContain('Extract all atomic facts');
  });
});

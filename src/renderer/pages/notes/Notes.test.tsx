import React from 'react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import Notes from './Notes';
import { renderMarkdown } from './MarkdownView';

const database = {
  getNotes: jest.fn(),
  createNote: jest.fn(),
  updateNote: jest.fn(),
  deleteNote: jest.fn(),
  getNoteVersions: jest.fn(),
  importNoteFiles: jest.fn(),
  exportNoteFiles: jest.fn(),
};

beforeAll(() => {
  (window as any).electron = { database, shell: { openExternal: jest.fn() } };
});

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.setItem('userId', JSON.stringify(7));
  database.getNotes.mockResolvedValue([
    {
      id: 1,
      title: 'API payloads',
      content: '{"id": 1}',
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-02T10:00:00.000Z',
      notebook: 'Work',
      tags: ['api'],
      pinned: false,
      format: 'json',
    },
    {
      id: 2,
      title: 'Shopping',
      content: '- milk',
      createdAt: '2026-01-01T10:00:00.000Z',
      notebook: '',
      tags: [],
      pinned: true,
      format: 'markdown',
    },
  ]);
  database.updateNote.mockImplementation(async (n: any) => ({
    ...n,
    updatedAt: '2026-02-01T00:00:00.000Z',
  }));
});

const renderNotes = async () => {
  await act(async () => {
    render(
      <MemoryRouter>
        <Notes />
      </MemoryRouter>,
    );
  });
};

describe('Notes', () => {
  it('lists notes pinned first and filters by search', async () => {
    await renderNotes();
    const titles = screen
      .getAllByText(/API payloads|Shopping/)
      .map((el) => el.textContent);
    expect(titles).toEqual(['Shopping', 'API payloads']);

    fireEvent.change(screen.getByLabelText('Search notes'), {
      target: { value: '#api' },
    });
    expect(screen.queryByText('Shopping')).not.toBeInTheDocument();
    expect(screen.getByText('API payloads')).toBeInTheDocument();
  });

  it('opens a note and autosaves edits', async () => {
    jest.useFakeTimers();
    await renderNotes();
    fireEvent.click(screen.getByText('Shopping'));
    fireEvent.change(screen.getByLabelText('Note content'), {
      target: { value: '- milk\n- bread' },
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    jest.useRealTimers();
    await waitFor(() =>
      expect(database.updateNote).toHaveBeenCalledWith(
        expect.objectContaining({ id: 2, content: '- milk\n- bread' }),
      ),
    );
  });

  it('shows JSON validation for JSON notes', async () => {
    await renderNotes();
    fireEvent.click(screen.getByText('API payloads'));
    expect(screen.getByText('Valid JSON')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Note content'), {
      target: { value: '{"id": }' },
    });
    expect(screen.queryByText('Valid JSON')).not.toBeInTheDocument();
  });
});

describe('renderMarkdown', () => {
  it('highlights code blocks and strips scripts', () => {
    const html = renderMarkdown(
      '```json\n{"a": 1}\n```\n\n<script>alert(1)</script><img src=x onerror=alert(1)>',
    );
    expect(html).toContain('hljs-attr');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });
});

describe('Compare', () => {
  // eslint-disable-next-line global-require
  const JsonCompare = require('./JsonCompare').default;

  it('treats differently formatted SQL as identical and shows real changes', () => {
    render(<JsonCompare notes={[]} onSaveAsNote={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'SQL' }));
    fireEvent.change(screen.getByLabelText('Left SQL'), {
      target: { value: 'select a, b from t where x = 1' },
    });
    fireEvent.change(screen.getByLabelText('Right SQL'), {
      target: { value: 'SELECT\n  a,\n  b\nFROM t\nWHERE x = 1' },
    });
    expect(screen.getAllByText('Identical').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Right SQL'), {
      target: { value: 'SELECT a, c FROM t WHERE x = 2' },
    });
    expect(screen.getByText(/changed line/)).toBeInTheDocument();
  });
});

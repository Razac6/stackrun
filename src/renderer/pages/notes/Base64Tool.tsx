import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Paper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import CheckIcon from '@mui/icons-material/Check';
import SaveAltIcon from '@mui/icons-material/SaveAlt';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CodeArea from './CodeArea';
import MarkdownView from './MarkdownView';
import {
  DecodedBase64,
  bytesToBase64,
  decodeBase64,
  formatBytes,
  toDataUrl,
} from './base64Tools';
import { MONO_FONT } from './highlight';
import useCopy from './useCopy';

// Base64 in both directions:
//  decode - paste base64 / a data: URL, see what it is (PDF, image, JSON, text...), preview
//           it, save it or open it in the default app
//  encode - pick or drop a file, get raw base64 or a data: URL to copy

type Direction = 'decode' | 'encode';

function Preview({ decoded }: { decoded: DecodedBase64 }) {
  // Blob URLs (not data: URLs) - large files preview without copying the string around
  const url = useMemo(() => {
    const blob = new Blob([decoded.bytes.buffer as ArrayBuffer], {
      type: decoded.mime,
    });
    return URL.createObjectURL(blob);
  }, [decoded]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  if (decoded.mime === 'application/pdf') {
    return (
      <Box
        component="iframe"
        title="PDF preview"
        src={url}
        sx={{ width: '100%', height: '100%', border: 0, borderRadius: 2 }}
      />
    );
  }
  if (decoded.mime.startsWith('image/')) {
    return (
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'auto',
          borderRadius: 2,
          // checkerboard so transparent images are visible
          backgroundImage:
            'conic-gradient(rgba(0,0,0,0.06) 25%, transparent 0 50%, rgba(0,0,0,0.06) 0 75%, transparent 0)',
          backgroundSize: '16px 16px',
        }}
      >
        <Box
          component="img"
          src={url}
          alt="Decoded"
          sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      </Box>
    );
  }
  if (decoded.mime === 'application/json' || decoded.mime.startsWith('text/')) {
    const text = new TextDecoder().decode(decoded.bytes);
    let pretty = text;
    if (decoded.mime === 'application/json') {
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch (e) {
        // keep as is
      }
    }
    return (
      <Box sx={{ height: '100%', overflow: 'auto' }}>
        <MarkdownView
          source={`\`\`\`${decoded.mime === 'application/json' ? 'json' : 'text'}\n${pretty.replace(/```/g, '`​``')}\n\`\`\``}
        />
      </Box>
    );
  }
  return (
    <Typography color="text.secondary" sx={{ m: 'auto', textAlign: 'center' }}>
      No preview for {decoded.mime}. Save or open it instead.
    </Typography>
  );
}

function Decode() {
  const [input, setInput] = useState('');
  const [name, setName] = useState('file');
  const [status, setStatus] = useState<string | null>(null);

  const result = useMemo(() => {
    if (!input.trim()) return { decoded: null, error: null };
    try {
      return { decoded: decodeBase64(input), error: null };
    } catch (e: any) {
      return { decoded: null, error: String(e?.message || e) };
    }
  }, [input]);
  const { decoded } = result;
  const fileName = decoded ? `${name || 'file'}.${decoded.extension}` : '';

  const save = async () => {
    if (!decoded) return;
    const path = await window.electron.database.saveBase64File(
      fileName,
      decoded.base64,
    );
    if (path) setStatus(`Saved to ${path}`);
  };
  const open = async () => {
    if (!decoded) return;
    const error = await window.electron.database.openBase64File(
      fileName,
      decoded.base64,
    );
    setStatus(error ? `Could not open: ${error}` : null);
  };

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 2fr) minmax(0, 3fr)' },
        gap: 1.5,
        height: '100%',
        minHeight: 0,
      }}
    >
      <Paper
        sx={{
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 360,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="subtitle2">Base64 or data: URL</Typography>
          <Button
            size="small"
            startIcon={<ContentPasteIcon fontSize="small" />}
            onClick={async () => setInput(await navigator.clipboard.readText())}
            sx={{ ml: 'auto' }}
          >
            Paste
          </Button>
        </Box>
        <Box sx={{ flex: 1, minHeight: 200 }}>
          <CodeArea
            value={input}
            onChange={setInput}
            language="plain"
            ariaLabel="Base64 input"
            placeholder="JVBERi0xLjQK… or data:image/png;base64,iVBORw0…"
            minHeight={0}
          />
        </Box>
        <Typography
          variant="caption"
          sx={{
            mt: 0.5,
            color: result.error ? 'error.main' : 'text.secondary',
          }}
        >
          {result.error ||
            (decoded
              ? `${decoded.mime} · ${formatBytes(decoded.bytes.length)}${
                  decoded.declaredMime && decoded.declaredMime !== decoded.mime
                    ? ` (declared ${decoded.declaredMime})`
                    : ''
                }`
              : 'Whitespace, URL-safe characters and missing padding are fine.')}
        </Typography>
      </Paper>

      <Paper
        sx={{
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 360,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mb: 1,
            flexWrap: 'wrap',
          }}
        >
          <Typography variant="subtitle2">Preview</Typography>
          <TextField
            size="small"
            variant="standard"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!decoded}
            InputProps={{
              inputProps: { 'aria-label': 'File name' },
              endAdornment: decoded ? (
                <Typography variant="body2" color="text.secondary">
                  .{decoded.extension}
                </Typography>
              ) : undefined,
            }}
            sx={{ ml: 'auto', width: 160 }}
          />
          <Button
            size="small"
            disabled={!decoded}
            startIcon={<OpenInNewIcon fontSize="small" />}
            onClick={open}
          >
            Open
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={!decoded}
            startIcon={<SaveAltIcon fontSize="small" />}
            onClick={save}
          >
            Save
          </Button>
        </Box>
        {status && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mb: 0.5 }}
            noWrap
          >
            {status}
          </Typography>
        )}
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {decoded ? (
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Preview decoded={decoded} />
            </Box>
          ) : (
            <Typography color="text.secondary" sx={{ m: 'auto' }}>
              The decoded file shows here.
            </Typography>
          )}
        </Box>
      </Paper>
    </Box>
  );
}

function Encode() {
  const [file, setFile] = useState<{
    name: string;
    mime: string;
    base64: string;
    size: number;
  } | null>(null);
  const [asDataUrl, setAsDataUrl] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { copy, copied } = useCopy();

  const load = async (f: File) => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    setFile({
      name: f.name,
      mime: f.type || 'application/octet-stream',
      base64: bytesToBase64(bytes),
      size: f.size,
    });
  };

  const output = file
    ? asDataUrl
      ? toDataUrl(file.base64, file.mime)
      : file.base64
    : '';
  // Huge strings would make the highlighted editor sluggish - show the start only
  const shown =
    output.length > 200_000 ? `${output.slice(0, 200_000)}…` : output;

  return (
    <Paper
      sx={{
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 360,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 1,
          flexWrap: 'wrap',
        }}
      >
        <Button
          size="small"
          variant="contained"
          startIcon={<UploadFileIcon fontSize="small" />}
          onClick={() => inputRef.current?.click()}
        >
          Choose file
        </Button>
        <input
          ref={inputRef}
          type="file"
          hidden
          aria-label="File to encode"
          onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
        />
        {file && (
          <Typography
            variant="body2"
            color="text.secondary"
            noWrap
            sx={{ minWidth: 0 }}
          >
            {file.name} · {file.mime} · {formatBytes(file.size)} →{' '}
            {formatBytes(output.length)} of text
          </Typography>
        )}
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1, alignItems: 'center' }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={asDataUrl ? 'url' : 'raw'}
            onChange={(_, v) => v && setAsDataUrl(v === 'url')}
          >
            <ToggleButton value="raw" sx={{ py: 0.25 }}>
              Base64
            </ToggleButton>
            <ToggleButton value="url" sx={{ py: 0.25 }}>
              Data URL
            </ToggleButton>
          </ToggleButtonGroup>
          <Button
            size="small"
            disabled={!output}
            startIcon={
              copied ? (
                <CheckIcon fontSize="small" />
              ) : (
                <ContentCopyIcon fontSize="small" />
              )
            }
            onClick={() => copy(output)}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </Box>
      </Box>
      <Box
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) load(f);
        }}
        sx={{
          flex: 1,
          minHeight: 0,
          borderRadius: 2,
          outline: dragging ? 2 : 0,
          outlineStyle: 'dashed',
          outlineColor: 'primary.main',
          bgcolor: (t) =>
            dragging ? alpha(t.palette.primary.main, 0.05) : undefined,
        }}
      >
        {file ? (
          <Box
            sx={{
              height: '100%',
              overflow: 'auto',
              fontFamily: MONO_FONT,
              fontSize: '0.75rem',
              wordBreak: 'break-all',
              p: 1.5,
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              userSelect: 'all',
            }}
          >
            {shown}
          </Box>
        ) : (
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 1,
              borderStyle: 'dashed',
              borderColor: 'divider',
              borderRadius: 2,
              color: 'text.secondary',
            }}
          >
            Drop a file here (PDF, image, anything) or choose one.
          </Box>
        )}
      </Box>
    </Paper>
  );
}

export default function Base64Tool() {
  const [direction, setDirection] = useState<Direction>('decode');
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <ToggleButtonGroup
        size="small"
        exclusive
        value={direction}
        onChange={(_, v) => v && setDirection(v)}
        sx={{ mb: 1.5, alignSelf: 'flex-start' }}
      >
        <ToggleButton value="decode">Base64 → file</ToggleButton>
        <ToggleButton value="encode">File → Base64</ToggleButton>
      </ToggleButtonGroup>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {direction === 'decode' ? <Decode /> : <Encode />}
      </Box>
    </Box>
  );
}

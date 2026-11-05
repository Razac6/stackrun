// Docker → "From Dockerfile": saved recipes (Dockerfile, image, container, ports, env…)
// that build the image and start a container of it, with the build log as it goes.
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import BuildIcon from '@mui/icons-material/BuildOutlined';
import StopIcon from '@mui/icons-material/Stop';
import {
  DockerfileRecipe,
  exposedPorts,
  recipeFor,
  recipeProblem,
} from '../../../main/dockerfileTools';
import { MONO_FONT } from './highlight';

const KEY = 'docker_recipes';
const newId = () => `df-${Date.now().toString(36)}`;

/** Rows of two fields with an empty one at the end to type the next. */
function Pairs<T extends object>({
  rows,
  keys,
  labels,
  onChange,
}: {
  rows: T[];
  keys: [keyof T, keyof T];
  labels: [string, string];
  onChange: (rows: T[]) => void;
}) {
  const empty = { [keys[0]]: '', [keys[1]]: '' } as unknown as T;
  const get = (r: T, k: keyof T) => String((r as any)[k] ?? '');
  const shown = [...rows, empty];
  const mono = { sx: { fontFamily: MONO_FONT, fontSize: 13 } };
  return (
    <Box
      sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 34px', gap: 0.5 }}
    >
      {shown.map((r, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <React.Fragment key={i}>
          {keys.map((k, j) => (
            <TextField
              key={String(k)}
              size="small"
              placeholder={labels[j]}
              value={get(r, k)}
              InputProps={mono}
              onChange={(e) => {
                const next = shown.map((x, n) =>
                  n === i ? { ...x, [k]: e.target.value } : x,
                );
                onChange(
                  next.filter(
                    (x, n) => n < rows.length || x[keys[0]] || x[keys[1]],
                  ),
                );
              }}
            />
          ))}
          {i < rows.length ? (
            <IconButton
              size="small"
              onClick={() => onChange(rows.filter((_, n) => n !== i))}
              aria-label="Remove"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          ) : (
            <span />
          )}
        </React.Fragment>
      ))}
    </Box>
  );
}

export default function DockerfileDialog({
  open,
  onClose,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  onStarted: (container: string) => void;
}) {
  const [recipes, setRecipes] = useState<DockerfileRecipe[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [log, setLog] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    window.electron.database.getAllSettings().then((s) => {
      try {
        const list = JSON.parse(s?.[KEY] || '[]');
        if (Array.isArray(list)) {
          setRecipes(list);
          setSelected((cur) => cur || list[0]?.id || null);
        }
      } catch (e) {
        setRecipes([]);
      }
    });
  }, [open]);

  useEffect(
    () =>
      window.electron.ipcRenderer.on('dockerfile:log', (msg: any) => {
        if (!msg?.id) return;
        setLog((m) => ({
          ...m,
          [msg.id]: [...(m[msg.id] || []), String(msg.line)].slice(-2000),
        }));
      }),
    [],
  );
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log, selected]);

  const save = (next: DockerfileRecipe[]) => {
    setRecipes(next);
    window.electron.database.setSetting(KEY, JSON.stringify(next));
  };
  const recipe = recipes.find((r) => r.id === selected) || null;
  const set = (patch: Partial<DockerfileRecipe>) =>
    recipe &&
    save(recipes.map((r) => (r.id === recipe.id ? { ...r, ...patch } : r)));

  const add = async () => {
    const picked = await window.electron.dockerfile.pick();
    if (!picked) return;
    const r = recipeFor(newId(), picked.path, picked.text);
    save([...recipes, r]);
    setSelected(r.id);
    setError(null);
  };

  const up = async (rebuild: boolean) => {
    if (!recipe) return;
    const problem = recipeProblem(recipe);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(recipe.id);
    setLog((m) => ({ ...m, [recipe.id]: [] }));
    const r = await window.electron.dockerfile.up(recipe, rebuild);
    setBusy(null);
    if (r.ok) onStarted(recipe.container);
    else setError(r.error);
  };

  const field = (
    key: keyof DockerfileRecipe,
    label: string,
    props: { placeholder?: string; helperText?: string } = {},
  ) =>
    recipe && (
      <TextField
        size="small"
        label={label}
        value={String(recipe[key] ?? '')}
        onChange={(e) =>
          set({ [key]: e.target.value } as Partial<DockerfileRecipe>)
        }
        InputProps={{ sx: { fontFamily: MONO_FONT, fontSize: 13 } }}
        fullWidth
        {...props}
      />
    );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Run a container from a Dockerfile</DialogTitle>
      <DialogContent>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '220px minmax(0, 1fr)',
            gap: 2,
            minHeight: 460,
          }}
        >
          <Box>
            <List dense>
              {recipes.map((r) => (
                <ListItemButton
                  key={r.id}
                  selected={r.id === selected}
                  onClick={() => {
                    setSelected(r.id);
                    setError(null);
                  }}
                  sx={{ borderRadius: 2 }}
                >
                  <ListItemText
                    primary={r.name}
                    secondary={r.image}
                    primaryTypographyProps={{ noWrap: true }}
                    secondaryTypographyProps={{
                      noWrap: true,
                      sx: { fontFamily: MONO_FONT, fontSize: 11 },
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
            <Button size="small" startIcon={<AddIcon />} onClick={add}>
              Dockerfile…
            </Button>
            {!recipes.length && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Pick a Dockerfile: the image and container get its folder&apos;s
                name, ports come from its EXPOSE lines.
              </Typography>
            )}
          </Box>

          {recipe ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1.25,
                minWidth: 0,
              }}
            >
              <Box
                sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}
              >
                {field('name', 'Name')}
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {field('dockerfile', 'Dockerfile')}
                  <Tooltip title="Pick another Dockerfile">
                    <IconButton
                      onClick={async () => {
                        const p = await window.electron.dockerfile.pick(
                          recipe.dockerfile,
                        );
                        if (p) set({ dockerfile: p.path });
                      }}
                      aria-label="Pick Dockerfile"
                    >
                      <FolderOpenOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {field('context', 'Build context', {
                    placeholder: "the Dockerfile's folder",
                  })}
                  <Tooltip title="Pick the build context folder">
                    <IconButton
                      onClick={async () => {
                        const p = await window.electron.dockerfile.pickFolder(
                          recipe.context,
                        );
                        if (p) set({ context: p });
                      }}
                      aria-label="Pick context folder"
                    >
                      <FolderOpenOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
                {field('target', 'Target stage', { placeholder: 'last stage' })}
                {field('image', 'Image', { placeholder: 'orders-api:dev' })}
                {field('container', 'Container name')}
                {field('network', 'Network', { placeholder: 'default' })}
                {field('extraRun', 'More docker run flags', {
                  placeholder: '--restart unless-stopped',
                })}
              </Box>
              <Box
                sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}
              >
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography variant="subtitle2" sx={{ flex: 1 }}>
                      Ports (host → container)
                    </Typography>
                    <Button
                      size="small"
                      onClick={async () => {
                        const text = await window.electron.dockerfile.read(
                          recipe.dockerfile,
                        );
                        if (!text) return;
                        const have = recipe.ports.map((p) => p.container);
                        set({
                          ports: [
                            ...recipe.ports,
                            ...exposedPorts(text)
                              .filter((p) => !have.includes(p))
                              .map((p) => ({
                                host: p.replace(/\/(tcp|udp)$/i, ''),
                                container: p,
                              })),
                          ],
                        });
                      }}
                    >
                      From EXPOSE
                    </Button>
                  </Box>
                  <Pairs
                    rows={recipe.ports}
                    keys={['host', 'container']}
                    labels={['8080', '80']}
                    onChange={(ports) => set({ ports })}
                  />
                  <Typography variant="subtitle2" sx={{ mt: 1.5 }}>
                    Volumes (host path → container path)
                  </Typography>
                  <Pairs
                    rows={recipe.volumes}
                    keys={['host', 'container']}
                    labels={['./src', '/app/src']}
                    onChange={(volumes) => set({ volumes })}
                  />
                </Box>
                <Box>
                  <Typography variant="subtitle2">Environment</Typography>
                  <Pairs
                    rows={recipe.env}
                    keys={['key', 'value']}
                    labels={['DB_URL', 'postgres://…']}
                    onChange={(env) => set({ env })}
                  />
                  <Typography variant="subtitle2" sx={{ mt: 1.5 }}>
                    Build args
                  </Typography>
                  <Pairs
                    rows={recipe.buildArgs}
                    keys={['key', 'value']}
                    labels={['NODE_ENV', 'development']}
                    onChange={(buildArgs) => set({ buildArgs })}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={recipe.noCache}
                        onChange={(e) => set({ noCache: e.target.checked })}
                      />
                    }
                    label={
                      <Typography variant="body2">
                        Build without cache
                      </Typography>
                    }
                  />
                </Box>
              </Box>
              {error && (
                <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>
                  {error}
                </Alert>
              )}
              <Box
                ref={logRef}
                sx={{
                  flex: 1,
                  minHeight: 140,
                  maxHeight: 220,
                  overflow: 'auto',
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  p: 1,
                  fontFamily: MONO_FONT,
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {(log[recipe.id] || []).join('\n') || (
                  <Typography variant="caption" color="text.secondary">
                    The build log shows up here.
                  </Typography>
                )}
              </Box>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography color="text.secondary">
                Add a Dockerfile to start.
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        {recipe && (
          <Button
            color="error"
            startIcon={<DeleteOutlineIcon />}
            disabled={!!busy}
            onClick={() => {
              save(recipes.filter((r) => r.id !== recipe.id));
              setSelected(null);
            }}
            sx={{ mr: 'auto' }}
          >
            Delete
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
        {busy ? (
          <Button
            color="error"
            variant="outlined"
            startIcon={<StopIcon />}
            onClick={() => window.electron.dockerfile.stopBuild(busy)}
          >
            Stop build
          </Button>
        ) : (
          <>
            <Tooltip title="Build the image again, then start the container">
              <span>
                <Button
                  startIcon={<BuildIcon />}
                  disabled={!recipe}
                  onClick={() => up(true)}
                >
                  Rebuild &amp; run
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Build only if the image is missing, then start (replaces the old container of this name)">
              <span>
                <Button
                  variant="contained"
                  startIcon={<PlayArrowIcon />}
                  disabled={!recipe}
                  onClick={() => up(false)}
                >
                  Build &amp; run
                </Button>
              </span>
            </Tooltip>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

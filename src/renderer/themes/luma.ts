import { createTheme, alpha, Theme } from '@mui/material/styles';

// Urbanist - thin geometric sans that carries the light, airy look of the UI
import '@fontsource/urbanist/300.css';
import '@fontsource/urbanist/400.css';
import '@fontsource/urbanist/500.css';
import '@fontsource/urbanist/600.css';
import '@fontsource/urbanist/700.css';

// Neutral design tokens - text, surfaces and lines. These never change; the brand colors
// below are user-configurable in Settings and live in theme.palette.
export const tokens = {
  ink: '#111214', // Near-black: text and the dark Activity band
  inkSoft: '#1c1d20', // Raised surfaces on dark sections
  graphite: '#2a2b2f',
  mute: '#8a8f98', // Secondary text, labels
  line: '#e6e8eb', // Hairlines, empty states
  canvas: '#eef0f2', // App background
  surface: '#ffffff', // Cards
  radiusCard: 24,
  shadowCard: '0 1px 2px rgba(17,18,20,0.04), 0 8px 24px rgba(17,18,20,0.06)',
};

// User-configurable brand colors (Settings > Appearance)
export interface LumaColors {
  primary: string; // Buttons, active nav pill, toggles -> palette.primary
  accent: string; // Active nav icon, glow, heatmap, selection -> palette.secondary
  highlight: string; // Dashboard highlight card -> palette.highlight
  band: string; // Dashboard Activity section background -> palette.band
}

export const lumaDefaults: LumaColors = {
  primary: '#111214',
  accent: '#c5e84a',
  highlight: '#ff7aa8',
  band: '#111214',
};

export function createLumaTheme(colors: LumaColors = lumaDefaults): Theme {
  const theme = createTheme({
    variant: 'luma',
    shape: {
      borderRadius: 6,
    },
    palette: {
      // light/dark/contrastText are derived, so any picked color stays readable
      primary: {
        main: colors.primary,
      },
      secondary: {
        main: colors.accent,
      },
      background: {
        default: tokens.canvas,
        paper: tokens.surface,
      },
      text: {
        primary: tokens.ink,
        secondary: tokens.mute,
      },
      divider: tokens.line,
      // Semantic colors stay close to Classic so statuses, task types and alerts keep the
      // meaning users already know - the monochrome look is limited to the chrome.
      info: {
        main: '#8ecae6',
      },
      success: {
        main: '#2e9d57',
      },
      warning: {
        main: '#fb8500',
      },
      error: {
        main: '#e5484d',
      },
    },
    typography: {
      fontFamily: '"Urbanist", "Helvetica", "Arial", sans-serif',
      h1: { fontWeight: 300, letterSpacing: '-0.02em' },
      h2: { fontWeight: 300, letterSpacing: '-0.02em' },
      h3: { fontWeight: 300, letterSpacing: '-0.01em' },
      h4: { fontWeight: 400, letterSpacing: '-0.01em' },
      h5: { fontWeight: 500 }, // Card headers
      h6: { fontWeight: 500 },
      subtitle1: { fontWeight: 500, color: tokens.mute }, // Card labels
      subtitle2: { fontWeight: 500, color: tokens.mute },
      body1: { fontWeight: 400 },
      body2: { fontWeight: 400, color: tokens.mute },
      caption: { fontWeight: 500 },
      overline: { fontWeight: 600, letterSpacing: '0.08em' },
      button: { fontWeight: 600, textTransform: 'none' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          // Establishes a real, percentage-inheritable height chain from the viewport down -
          // without this, "height: 100%" on a page (List.tsx etc.) resolves to nothing, forcing
          // pages to guess their available height via fragile "calc(100vh - Npx)" magic numbers
          // that drift out of sync with the actual AppBar/Toolbar chrome and cause extra scroll.
          html: {
            height: '100%',
          },
          body: {
            height: '100%',
            margin: 0,
            fontFamily: '"Urbanist", "Helvetica", "Arial", sans-serif',
            WebkitFontSmoothing: 'antialiased',
          },
          '#root': {
            height: '100%',
          },
          '*': {
            scrollbarWidth: 'thin', // Firefox
            scrollbarColor: '#c9cdd2 transparent',
          },
          '*::-webkit-scrollbar': {
            width: '8px',
            height: '8px',
          },
          '*::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: '#c9cdd2',
            borderRadius: '8px',
          },
          '*::-webkit-scrollbar-thumb:hover': {
            backgroundColor: '#a9aeb5',
          },
        },
      },
      MuiPaper: {
        defaultProps: {
          elevation: 0,
        },
        styleOverrides: {
          rounded: {
            borderRadius: tokens.radiusCard,
          },
          elevation0: {
            boxShadow: tokens.shadowCard,
          },
          elevation1: {
            boxShadow: tokens.shadowCard,
          },
          elevation2: {
            boxShadow: tokens.shadowCard,
          },
          elevation3: {
            boxShadow: tokens.shadowCard,
          },
        },
      },
      MuiCard: {
        defaultProps: {
          elevation: 0,
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 28,
            boxShadow: '0 24px 64px rgba(17,18,20,0.18)',
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 16,
          },
        },
      },
      MuiPopover: {
        styleOverrides: {
          paper: {
            borderRadius: 16,
          },
        },
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true,
        },
        styleOverrides: {
          root: {
            borderRadius: 999,
            paddingLeft: 18,
            paddingRight: 18,
          },
          outlined: {
            borderColor: tokens.line,
            '&:hover': {
              borderColor: colors.primary,
              backgroundColor: 'transparent',
            },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            transition: 'background-color 0.2s, color 0.2s',
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            fontWeight: 500,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 14,
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: tokens.line,
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: alpha(tokens.ink, 0.4),
            },
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            gap: 4,
            padding: 4,
            borderRadius: 999,
            backgroundColor: tokens.canvas,
          },
          grouped: {
            border: 'none !important',
            borderRadius: '999px !important',
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            color: tokens.mute,
            '&.Mui-selected, &.Mui-selected:hover': {
              backgroundColor: colors.primary,
              color: 'var(--thingy-primary-contrast, #ffffff)',
            },
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: tokens.ink,
            fontSize: '0.75rem',
            fontWeight: 500,
            borderRadius: 10,
            padding: '6px 10px',
          },
          arrow: {
            color: tokens.ink,
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            backgroundColor: tokens.line,
          },
          bar: {
            borderRadius: 999,
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: tokens.canvas,
            borderRight: 'none',
            boxShadow: 'none',
            // Nav items are pills: collapsed they read as round icon buttons, expanded as
            // labelled pills. Scoped to the drawer so other lists keep the default look.
            '& .MuiListItemButton-root': {
              margin: '4px 8px',
              paddingLeft: 12,
              paddingRight: 12,
              borderRadius: 999,
              color: tokens.ink,
              '&:hover': {
                backgroundColor: alpha(tokens.ink, 0.06),
              },
            },
            '& .MuiListItemButton-root.Mui-selected': {
              backgroundColor: colors.primary,
              color: 'var(--thingy-primary-contrast, #ffffff)',
              '& .MuiListItemIcon-root': {
                color: colors.accent,
              },
              '&:hover': {
                backgroundColor: alpha(colors.primary, 0.88),
              },
            },
            '& .MuiListItemIcon-root': {
              color: tokens.ink,
            },
            '& .MuiListItemText-primary': {
              fontWeight: 500,
            },
          },
        },
      },
    },
  });

  // Custom palette keys aren't completed by createTheme (no light/dark/contrastText),
  // so build them with augmentColor.
  return createTheme(theme, {
    palette: {
      band: theme.palette.augmentColor({
        color: { main: colors.band },
        name: 'band',
      }),
      highlight: theme.palette.augmentColor({
        color: { main: colors.highlight },
        name: 'highlight',
      }),
      progress: theme.palette.augmentColor({
        color: { main: '#219ebc', contrastText: '#ffffff' },
        name: 'progress',
      }),
      review: theme.palette.augmentColor({
        color: { main: '#7e57c2', contrastText: '#ffffff' },
        name: 'review',
      }),
    },
  });
}

export default createLumaTheme();

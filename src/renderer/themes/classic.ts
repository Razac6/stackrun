import { createTheme } from '@mui/material/styles';

// Import the Roboto font with the desired weights
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';

const theme = createTheme({
  variant: 'classic',
  palette: {
    primary: {
      main: '#219ebc', // Main blue
    },
    secondary: {
      main: '#ffb703', // Accent yellow/orange
    },
    background: {
      default: '#f0f4f8', // A very light, cool grey
      paper: '#ffffff', // White for cards, drawers, etc.
    },
    text: {
      primary: '#023047', // Dark blue for primary text
      secondary: '#5f7d8b', // A softer blue-grey for secondary text
    },
    // Adding the other colors for potential use
    info: {
      main: '#8ecae6', // Light blue
    },
    warning: {
      main: '#fb8500', // Accent orange
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 300, color: '#023047' },
    h2: { fontWeight: 300, color: '#023047' },
    h3: { fontWeight: 300, color: '#023047' },
    h4: { fontWeight: 500, color: '#023047' }, // Reverted to default dark color
    h5: { fontWeight: 500, color: '#fb8500' }, // Card headers
    h6: { fontWeight: 500 }, // Removed color to allow inheritance
    subtitle1: { fontWeight: 400, color: '#fb8500' }, // Card subtitles
    body1: { fontWeight: 300, color: '#023047' },
    body2: { fontWeight: 300, color: '#5f7d8b' },
    button: { fontWeight: 500, textTransform: 'none' },
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
        },
        '#root': {
          height: '100%',
        },
        '*': {
          scrollbarWidth: 'thin', // Firefox
          scrollbarColor: '#c1ccd4 transparent',
        },
        '*::-webkit-scrollbar': {
          width: '8px',
          height: '8px',
        },
        '*::-webkit-scrollbar-track': {
          background: 'transparent',
        },
        '*::-webkit-scrollbar-thumb': {
          backgroundColor: '#c1ccd4',
          borderRadius: '8px',
        },
        '*::-webkit-scrollbar-thumb:hover': {
          backgroundColor: '#9fb0bc',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#023047', // Deep blue for the AppBar
          color: '#ffffff',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#023047',
          // Apply text and icon colors only to items inside the drawer
          '& .MuiListItemText-primary': {
            color: '#ffffff', // White for text
          },
          '& .MuiListItemIcon-root': {
            color: '#ef476f', // New icon color
          },
        },
      },
    },
  },
});

// Task / sprint status colors - exactly what statuses always used (primary / secondary).
// Custom palette keys aren't completed by createTheme, so pass full color objects.
export default createTheme(theme, {
  palette: {
    progress: theme.palette.primary,
    review: theme.palette.secondary,
    highlight: theme.palette.secondary,
    band: theme.palette.augmentColor({
      color: { main: '#023047' },
      name: 'band',
    }),
  },
});

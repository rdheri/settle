import { BrowserRouter } from 'react-router-dom';
import { AppShell } from './components/layout';
import { DataContext } from './lib/dataContext';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';
import { useSettleData } from './lib/useSettleData';

function Root(): React.JSX.Element {
  const data = useSettleData();
  return (
    <DataContext.Provider value={data}>
      <AppShell />
    </DataContext.Provider>
  );
}

export function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <Root />
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  );
}

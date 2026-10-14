import { HashRouter, Route, Routes } from 'react-router-dom';
import { About, Home } from './views';

export function Root() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </HashRouter>
  );
}

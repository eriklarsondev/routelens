import { Route, Routes } from 'react-router-dom';
import { Contact, Faq } from './views';

// Rendered under `/help/*`, so these relative paths hang off `/help`.
export default function HelpRoutes() {
  return (
    <Routes>
      <Route index element={<Faq />} />
      <Route path="contact" element={<Contact />} />
    </Routes>
  );
}

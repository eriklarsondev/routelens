import { Link } from 'react-router-dom';

// A menu is a list of `{ path, label }` too, but it says nothing about what renders.
const navItems = [
  { path: '/menu-only', label: 'Menu only' },
  { path: '/account', label: 'Account' },
];

export function Nav() {
  return (
    <nav>
      {navItems.map((item) => (
        <Link key={item.path} to={item.path}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

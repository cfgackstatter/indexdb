import { Link, Route, Routes, useLocation } from "react-router-dom";
import MainPage from "./MainPage";
import Admin from "./Admin";

function NavTabs() {
  const location = useLocation();
  const isMain = location.pathname === "/";
  const isAdmin = location.pathname === "/admin";

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Link
        to="/"
        className={`pill-button ${isMain ? "pill-button-active" : ""}`}
      >
        Analytics
      </Link>
      <Link
        to="/admin"
        className={`pill-button ${isAdmin ? "pill-button-active" : ""}`}
      >
        Admin
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <div className="app-title">IndexDB</div>
          <div className="app-subtitle">
            Index Analytics
          </div>
        </div>
        <NavTabs />
      </header>

      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </div>
  );
}

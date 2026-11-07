import {
  BrowserRouter as Router,
  Routes,
  Route,
} from 'react-router-dom';

import DefaultLayout from '@layout/DefaultLayout';

export default function AppRoutes() {
  return (
    <Router>
      <Routes>
        <Route element={<DefaultLayout />}>
          {/* <Route path="/" element={<Home />} /> */}
        </Route>
      </Routes>
    </Router>
  );
}

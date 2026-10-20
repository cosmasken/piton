import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import Faucet from './Faucet';
import Dashboard from './Dashboard';
import Home from './home';

import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<Home />} />
        <Route path='/faucet' element={<Faucet />} />
        <Route path='/dashboard' element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

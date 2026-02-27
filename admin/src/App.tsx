import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Items from './pages/Items';
import Locations from './pages/Locations';
import ReceivingList from './pages/ReceivingList';
import ReceivingEdit from './pages/ReceivingEdit';
import ConsumptionList from './pages/ConsumptionList';
import ConsumptionEdit from './pages/ConsumptionEdit';
import Lots from './pages/Lots';
import Movements from './pages/Movements';

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Layout />}>
                    <Route index element={<Dashboard />} />
                    <Route path="items" element={<Items />} />
                    <Route path="locations" element={<Locations />} />
                    <Route path="receiving" element={<ReceivingList />} />
                    <Route path="receiving/:id" element={<ReceivingEdit />} />
                    <Route path="consumption" element={<ConsumptionList />} />
                    <Route path="consumption/:id" element={<ConsumptionEdit />} />
                    <Route path="lots" element={<Lots />} />
                    <Route path="movements" element={<Movements />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}

export default App;

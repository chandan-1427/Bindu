import {
	BrowserRouter,
	Navigate,
	Route,
	Routes,
} from "react-router";
import { useEffect } from "react";
import { Sidebar } from "~/components/Sidebar";
import { StreamPanel } from "~/components/StreamPanel";
import { DetailRail } from "~/components/DetailRail";
import { RegisterModal } from "~/components/RegisterModal";
import { useUI } from "~/state";

function Shell() {
	const openRegister = useUI((s) => s.openRegister);
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
				e.preventDefault();
				openRegister();
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [openRegister]);

	return (
		<div className="flex h-screen w-full overflow-hidden text-fg">
			<Sidebar />
			<StreamPanel />
			<DetailRail />
			<RegisterModal />
		</div>
	);
}

export default function App() {
	return (
		<BrowserRouter>
			<Routes>
				<Route path="/" element={<Navigate to="/agents/writer" replace />} />
				<Route path="/agents/:agentId" element={<Shell />} />
			</Routes>
		</BrowserRouter>
	);
}

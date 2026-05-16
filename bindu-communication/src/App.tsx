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
import { ComposeModal } from "~/components/ComposeModal";
import { useUI } from "~/state";
import { mapWebhookToEvent } from "~/lib/liveStream";

function Shell() {
	const openRegister = useUI((s) => s.openRegister);
	const openCompose = useUI((s) => s.openCompose);
	const showCompose = useUI((s) => s.showCompose);
	const closeCompose = useUI((s) => s.closeCompose);
	const addLiveEvent = useUI((s) => s.addLiveEvent);

	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "n") {
				e.preventDefault();
				openRegister();
				return;
			}
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
				e.preventDefault();
				openCompose();
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [openRegister, openCompose]);

	useEffect(() => {
		const token = import.meta.env.VITE_COMMS_TOKEN as string | undefined;
		const url = token
			? `/api/events/stream?token=${encodeURIComponent(token)}`
			: "/api/events/stream";
		const es = new EventSource(url);
		es.onmessage = (msg) => {
			try {
				addLiveEvent(mapWebhookToEvent(JSON.parse(msg.data)));
			} catch (err) {
				console.warn("bad event", err);
			}
		};
		return () => es.close();
	}, [addLiveEvent]);

	return (
		<div className="flex h-screen w-full overflow-hidden text-fg">
			<Sidebar />
			<StreamPanel />
			<DetailRail />
			<RegisterModal />
			<ComposeModal open={showCompose} onClose={closeCompose} />
		</div>
	);
}

export default function App() {
	return (
		<BrowserRouter>
			<Routes>
				<Route path="/" element={<Navigate to="/inbox" replace />} />
				<Route path="/inbox" element={<Shell />} />
				<Route path="/sent" element={<Shell />} />
				<Route path="/archive" element={<Shell />} />
				<Route path="/agents/:agentId" element={<Shell />} />
			</Routes>
		</BrowserRouter>
	);
}

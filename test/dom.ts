// A browser for component tests: import this first in a test file. Only that file gets the DOM;
// it's taken down again after it, so the server tests keep Bun's own fetch and WebSocket.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll } from "bun:test";

GlobalRegistrator.register({ url: "http://localhost:3000/" });
afterAll(() => GlobalRegistrator.unregister());

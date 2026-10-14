import "@fontsource-variable/jetbrains-mono";
import { mount } from "svelte";
import "./app.css";
import "./legacy.css";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });

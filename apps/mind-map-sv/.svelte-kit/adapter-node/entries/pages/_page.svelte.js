import { e as escape_html } from "../../chunks/escaping.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const { data } = $$props;
    $$renderer2.push(`<h1>Welcome to SvelteKit</h1> <p>Visit <a href="https://svelte.dev/docs/kit">svelte.dev/docs/kit</a> to read the documentation</p> APP_NAME: ${escape_html(data.appName || "No APP_NAME")}`);
  });
}
export {
  _page as default
};

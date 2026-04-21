# macOS

## Start with the compound surface

```bash
interceptor macos open "Finder"
interceptor macos read
interceptor macos act e5
interceptor macos inspect
```

- Use the compound commands first for native-app exploration, the same way you use `open`, `read`, `act`, and `inspect` in the browser.

## Use the AX tree before raw input

- Use `tree`, `find`, `focused`, `value`, `action`, and `windows` to understand the frontmost app.
- Use `click`, `type`, `keys`, `scroll`, `drag`, `move`, and `resize` when the tree exposes the needed target.
- Let Interceptor escalate to CGEvent input when AX actions are insufficient, or use the direct trusted input command when precision matters.

## Check permissions before claiming success

- Run `interceptor macos trust` when the task depends on Accessibility, Screen Recording, or Microphone access.
- Expect screenshots, streaming, speech recognition, OCR, and sound classification to fail or degrade when permissions are missing.
- Treat `interceptor macos trust` as a permission snapshot, not a full runtime-health check.
- For packaged installs, also run `interceptor status` to confirm the bundled helper is enabled and the bridge socket is live.
- For microphone-sensitive workflows, verify the live path with `interceptor macos audio input start` and `interceptor macos audio input stop` after trust looks good.
- If `interceptor macos *` reports `Interceptor bridge not running` or `connection closed before response`, the helper lifecycle is still unhealthy even if `trust` says permissions are granted.

## Use the native-only capabilities deliberately

- Use `menu` for deterministic menu traversal.
- Use `monitor` to learn native desktop workflows and export replayable plans.
- Use `vision`, `nlp`, `listen`, `vad`, `sounds`, `audio`, `display`, and `stream` only when the task explicitly benefits from those surfaces.

## Keep boundaries clear

- Use browser `interceptor` commands for web content.
- Use `interceptor macos` for native apps, browser chrome, OS dialogs, or trusted input that must bypass DOM simulation.

## Packaged-install notes

- The shipped app now owns helper registration and privacy onboarding from `/Applications/Interceptor.app`.
- `interceptor macos trust` in a packaged install should be interpreted as app-owned trust state, not as proof that a shell-launched probe or a live bridge action will succeed.

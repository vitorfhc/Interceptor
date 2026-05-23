const input = document.getElementById("contextId") as HTMLInputElement
const saveBtn = document.getElementById("save") as HTMLButtonElement
const resetBtn = document.getElementById("reset") as HTMLButtonElement
const statusEl = document.getElementById("status") as HTMLDivElement

function showStatus(msg: string, ms = 1800) {
  statusEl.textContent = msg
  setTimeout(() => { statusEl.textContent = "" }, ms)
}

chrome.storage.local.get("contextId").then((stored) => {
  const contextId = (stored as { contextId?: unknown }).contextId
  if (typeof contextId === "string") input.value = contextId
})

saveBtn.addEventListener("click", async () => {
  const value = input.value.trim()
  if (!value) { showStatus("Context ID cannot be empty."); return }
  await chrome.storage.local.set({ contextId: value })
  showStatus("Saved.")
})

resetBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove("contextId")
  input.value = ""
  showStatus("Reset — new ID assigned on next connect.")
})

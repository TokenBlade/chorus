import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Conversation management
  createConversation: (title?: string) => ipcRenderer.invoke('create-conversation', title),
  listConversations: () => ipcRenderer.invoke('list-conversations'),
  getConversationDetails: (conversationId: string) =>
    ipcRenderer.invoke('get-conversation-details', conversationId),
  sendMessageInConversation: (conversationId: string, prompt: string, providers?: string[]) =>
    ipcRenderer.invoke('send-message-in-conversation', conversationId, prompt, providers),
  renameConversation: (conversationId: string, title: string) =>
    ipcRenderer.invoke('rename-conversation', conversationId, title),
  hideConversation: (conversationId: string) =>
    ipcRenderer.invoke('hide-conversation', conversationId),

  // Provider session management
  initializeProvider: (provider: string) => ipcRenderer.invoke('initialize-provider', provider),

  // Ratings
  saveProviderRating: (input: { providerResultId: string; score: number; tags: string[]; note?: string }) =>
    ipcRenderer.invoke('save-provider-rating', input),

  // Streaming events
  onProviderStreamEvent: (callback: (data: unknown) => void) => {
    ipcRenderer.on('provider-stream-event', (_event, data) => callback(data))
  },
  removeProviderStreamListeners: () => {
    ipcRenderer.removeAllListeners('provider-stream-event')
  },

  // Single-provider in-thread chat
  sendSingleProviderMessage: (conversationId: string, prompt: string, provider: string) =>
    ipcRenderer.invoke('send-single-provider-message', conversationId, prompt, provider),

  // User actions on provider results
  saveUserRating: (resultId: string, rating: 'good' | 'bad' | null) =>
    ipcRenderer.invoke('save-user-rating', resultId, rating),
  markViewed: (resultId: string) =>
    ipcRenderer.invoke('mark-viewed', resultId),

  // Regenerate a single provider
  regenerateProvider: (queryId: string, provider: string, conversationId: string) =>
    ipcRenderer.invoke('regenerate-provider', queryId, provider, conversationId),

  // Rate on the LLM portal (passthrough mode)
  rateOnProvider: (provider: string, rating: 'good' | 'bad') =>
    ipcRenderer.invoke('rate-on-provider', provider, rating),

  // Open URL in default browser
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
})

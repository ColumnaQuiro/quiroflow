import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.quiroflow.app',
  appName: 'QuiroFlow',
  webDir: '.output/public',
  plugins: {
    Keyboard: {
      resize: 'body',
    },
  },
}

export default config

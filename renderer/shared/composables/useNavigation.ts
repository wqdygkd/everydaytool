export function useNavigation() {
  const router = useRouter()
  const route = useRoute()

  function goToHome(): void {
    router.push({ name: 'home' })
  }

  function goToTool(toolId: string): void {
    router.push({ name: `tool-${toolId}` })
  }

  function goBack(): void {
    if (route.meta?.toolId) {
      goToHome()
    } else {
      router.back()
    }
  }

  const currentTool = computed(() => (typeof route.meta?.toolId === 'string' ? route.meta.toolId : null))
  const isHome = computed(() => route.name === 'home')

  return { goToHome, goToTool, goBack, currentTool, isHome }
}

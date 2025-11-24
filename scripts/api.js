// api.js - Cliente para comunicarse con el backend
// Coloca este archivo en la carpeta scripts/

const API_BASE_URL = 'https://webway-2-production.up.railway.app/api'; // Cambiar en producción

class ARAnalyticsAPI {
    constructor() {
        this.sessionId = null;
        this.userTypeId = null;
        this.sessionStartTime = null;
    }

    // ═══════════════════════════════════════════════════════════
    // GESTIÓN DE SESIÓN
    // ═══════════════════════════════════════════════════════════

    /**
     * Obtener tipos de usuario disponibles
     */
    async getUserTypes() {
        try {
            const response = await fetch(`${API_BASE_URL}/user-types`);
            const data = await response.json();
            return data.data;
        } catch (error) {
            console.error('Error obteniendo tipos de usuario:', error);
            return [];
        }
    }

    /**
     * Iniciar sesión cuando el usuario selecciona su tipo
     */
    async startSession(userTypeId) {
        try {
            const deviceInfo = {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                language: navigator.language,
                screenSize: `${window.screen.width}x${window.screen.height}`,
                timestamp: new Date().toISOString()
            };

            const response = await fetch(`${API_BASE_URL}/session/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_type_id: userTypeId,
                    device_info: JSON.stringify(deviceInfo)
                })
            });

            const data = await response.json();

            if (data.success) {
                this.sessionId = data.session_id;
                this.userTypeId = userTypeId;
                this.sessionStartTime = new Date();

                // Guardar en localStorage por si se recarga la página
                sessionStorage.setItem('ar_session_id', this.sessionId);
                sessionStorage.setItem('ar_user_type_id', this.userTypeId);
                sessionStorage.setItem('ar_session_start', this.sessionStartTime.toISOString());

                console.log('✅ Sesión iniciada:', this.sessionId);
                return true;
            }

            return false;
        } catch (error) {
            console.error('Error iniciando sesión:', error);
            return false;
        }
    }

    /**
     * Finalizar sesión
     */
    async endSession() {
        if (!this.sessionId) return;

        try {
            await fetch(`${API_BASE_URL}/session/end`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: this.sessionId })
            });

            // Limpiar datos locales
            sessionStorage.removeItem('ar_session_id');
            sessionStorage.removeItem('ar_user_type_id');
            sessionStorage.removeItem('ar_session_start');

            this.sessionId = null;
            this.userTypeId = null;
            this.sessionStartTime = null;

            console.log('✅ Sesión finalizada');
        } catch (error) {
            console.error('Error finalizando sesión:', error);
        }
    }

    /**
     * Recuperar sesión desde localStorage (si existe)
     */
    restoreSession() {
        const sessionId = sessionStorage.getItem('ar_session_id');
        const userTypeId = sessionStorage.getItem('ar_user_type_id');
        const sessionStart = sessionStorage.getItem('ar_session_start');

        if (sessionId && userTypeId) {
            this.sessionId = parseInt(sessionId);
            this.userTypeId = parseInt(userTypeId);
            this.sessionStartTime = new Date(sessionStart);
            console.log('✅ Sesión restaurada:', this.sessionId);
            return true;
        }

        return false;
    }

    /**
     * Verificar si hay sesión activa
     */
    hasActiveSession() {
        return this.sessionId !== null;
    }

    // ═══════════════════════════════════════════════════════════
    // TRACKING DE NAVEGACIONES
    // ═══════════════════════════════════════════════════════════

    /**
     * Registrar navegación a un POI
     */
    async registerNavigation(poiId, navigationData) {
        if (!this.hasActiveSession()) {
            console.warn('No hay sesión activa para registrar navegación');
            return false;
        }

        // NUEVO: Evitar registros duplicados
        const navigationKey = `nav_${this.sessionId}_${poiId}_${Date.now()}`;
        if (sessionStorage.getItem(navigationKey)) {
            console.warn('Navegación ya registrada, evitando duplicado');
            return true;
        }

        try {
            const response = await fetch(`${this.baseUrl}/navigations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    poi_id: poiId,
                    origin_lat: navigationData.originLat,
                    origin_lon: navigationData.originLon,
                    navigation_timestamp: new Date().toISOString(),
                    duration_seconds: navigationData.duration || 0,
                    distance_meters: navigationData.distance || 0,
                    completed: navigationData.completed || false
                })
            });

            const data = await response.json();

            if (data.success) {
                console.log('✅ Navegación registrada:', data.data);
                // NUEVO: Marcar como registrado
                sessionStorage.setItem(navigationKey, 'true');
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error registrando navegación:', error);
            return false;
        }
    }

    /**
     * Registrar búsqueda
     */
    async registerSearch(poiId) {
        if (!this.hasActiveSession()) {
            console.warn('No hay sesión activa para registrar búsqueda');
            return false;
        }

        try {
            const response = await fetch(`${this.baseUrl}/search-logs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    poi_id: poiId,
                    search_timestamp: new Date().toISOString()
                })
            });

            const data = await response.json();

            if (data.success) {
                console.log('✅ Búsqueda registrada:', poiId);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error registrando búsqueda:', error);
            return false;
        }
    }
    // ═══════════════════════════════════════════════════════════
    // OBTENER POIs (desde el backend en lugar de pois.json)
    // ═══════════════════════════════════════════════════════════

    /**
     * Obtener todos los POIs desde el backend
     */
    async getPOIs() {
        try {
            const response = await fetch(`${API_BASE_URL}/pois`);
            const data = await response.json();
            return data.data;
        } catch (error) {
            console.error('Error obteniendo POIs:', error);
            // Fallback a pois.json local si el backend no está disponible
            const fallback = await fetch('../data/pois.json');
            return await fallback.json();
        }
    }

    /**
     * Obtener un POI específico
     */
    async getPOI(poiId) {
        try {
            const response = await fetch(`${API_BASE_URL}/pois/${poiId}`);
            const data = await response.json();
            return data.data;
        } catch (error) {
            console.error('Error obteniendo POI:', error);
            return null;
        }
    }
}

// Crear instancia global
const arAPI = new ARAnalyticsAPI();

// Intentar restaurar sesión al cargar la página
window.addEventListener('load', () => {
    arAPI.restoreSession();
});

// Finalizar sesión al cerrar/recargar la página
window.addEventListener('beforeunload', () => {
    // Solo enviar señal, no esperar respuesta para no bloquear
    if (arAPI.hasActiveSession()) {
        navigator.sendBeacon(`${API_BASE_URL}/session/end`,
            JSON.stringify({ session_id: arAPI.sessionId })
        );
    }
});

// Exportar para uso en otros scripts
window.arAPI = arAPI;
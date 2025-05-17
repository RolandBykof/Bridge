/**
 * BridgeCircle - Main Application
 * Main application module and initialization
 */

// When DOM is ready, initialize application
document.addEventListener('DOMContentLoaded', initializeApp);

/**
 * Initializes the application
 */
async function initializeApp() {
    console.log('BridgeCircle application starting...');
    
    // Try to initialize GIB service
    try {
        await gibService.initialize();
        if (gibService.isAvailable()) {
            console.log('GIB service is available.');
        } else {
            console.log('GIB service could not be initialized, using simulated game.');
        }
    } catch (error) {
        console.error('Error initializing GIB service:', error);
    }
    
    // Set event listeners for UI elements
    setupEventListeners();
    
    // Render UI
    renderUI();
    
    // Handle potential CORS issues
    handleCORSIssues();
    
    // Tarkista onko selaimen kokoruututila tuettu
    checkFullscreenSupport();
    
    console.log('BridgeCircle application initialized.');
}

/**
 * Checks if the browser supports fullscreen mode
 */
function checkFullscreenSupport() {
    const fullscreenButton = document.getElementById('fullscreen-button');
    
    if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled && 
        !document.mozFullScreenEnabled && !document.msFullscreenEnabled) {
        // Jos kokoruututila ei ole tuettu, piilota nappi
        if (fullscreenButton) {
            fullscreenButton.style.display = 'none';
        }
        console.log('Fullscreen mode is not supported in this browser');
    } else {
        console.log('Fullscreen mode is supported');
    }
}

/**
 * Handles potential CORS issues
 */
function handleCORSIssues() {
    // This is a simple check that can be expanded if needed
    const warningMessage = 'Using GIB service directly from browser may encounter CORS restrictions. ' +
                          'If GIB features don\'t work, consider using a proxy server.';
    
    if (gibService.apiBaseUrl.startsWith('http:') && window.location.protocol === 'https:') {
        console.warn(warningMessage);
        console.warn('Mixed content: GIB service uses HTTP but application is on HTTPS.');
    }
}

/**
 * Handles errors in a user-friendly way
 */
function handleError(error, context) {
    console.error(`Error (${context}):`, error);
    
    let message = 'An error occurred. Please try again.';
    
    // Define a more user-friendly error message based on context
    if (context === 'gib-deal') {
        message = 'Failed to fetch cards from GIB service. Using random cards instead.';
    } else if (context === 'gib-move') {
        message = 'Failed to fetch GIB move. Using simulated move instead.';
    }
    
    // Show error message to user
    updateStatus(message);
    announceToScreenReader(message);
}

/**
 * Monitors application performance (can be expanded as needed)
 */
function monitorPerformance() {
    // Performance monitoring can be implemented here
    // For example, timing measurements for API calls
}

/**
 * Utility function for async operations
 */
async function asyncTryCatch(asyncFn, errorContext) {
    try {
        return await asyncFn();
    } catch (error) {
        handleError(error, errorContext);
        return null;
    }
}
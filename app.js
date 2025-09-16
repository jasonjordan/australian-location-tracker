class LocationTrackerApp {
    constructor() {
        this.map = null;
        this.userMarker = null;
        this.poiMarkers = [];
        this.serviceMarkers = [];
        this.currentPosition = null;
        this.lastPoiUpdatePosition = null;
        this.updateThreshold = 200; // meters
        this.cache = {
            pois: {},
            speedLimits: {},
            services: {}
        };
        this.audio = null;
        this.audioBuffering = false;
        this.cacheBuster = Date.now();
        
        // Initialize after a small delay to ensure DOM is ready
        setTimeout(() => this.init(), 100);
    }
    
    init() {
        console.log('[DEBUG] Initializing LocationTrackerApp...');
        // Check if we're running in a secure context (HTTPS)
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
            console.error('[DEBUG] App requires HTTPS. Halting initialization.');
            alert('This app requires HTTPS for location services. Please access via HTTPS.');
            return;
        }
        
        this.setupMap();
        this.setupAudio();
        this.startLocationTracking();
        this.setupEventListeners();
        
        // Initialize service worker for offline support (Cloudflare Pages compatible)
        this.setupServiceWorker();
        console.log('[DEBUG] Initialization complete.');
    }
    
    setupServiceWorker() {
        if ('serviceWorker' in navigator) {
            // Register service worker with cache-busting
            navigator.serviceWorker.register('/sw.js?v=' + this.cacheBuster)
                .then(registration => {
                    console.log('Service Worker registered with scope:', registration.scope);
                })
                .catch(error => {
                    console.log('Service Worker registration failed:', error);
                    // App will still work without service worker
                });
        }
    }
    
    setupMap() {
        console.log('[DEBUG] Setting up map...');
        // Initialize Leaflet map
        this.map = L.map('map-container', {
            zoomControl: false // We'll add our own
        }).setView([-25.2744, 133.7751], 4); // Center on Australia
        
        // Add zoom control
        L.control.zoom({
            position: 'bottomright'
        }).addTo(this.map);
        
        // Add OpenStreetMap tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            // Add cache-busting for tiles
            tileSize: 256,
        }).addTo(this.map);
        
        // Create user location marker
        this.userMarker = L.marker([-25.2744, 133.7751], {
            icon: L.divIcon({
                className: 'user-location-icon',
                html: '<div style="background-color: #ff4d4d; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 5px rgba(255, 0, 0, 0.7);"></div>',
                iconSize: [22, 22],
                iconAnchor: [11, 11]
            })
        }).addTo(this.map);
    }
    
    setupAudio() {
        this.audio = new Audio();
        // Use the direct stream URL
        this.audio.src = 'https://listen.happyradio.live/listen/live/radio.mp3';
        this.audio.preload = 'auto';
        
        // Set up aggressive buffering
        this.audio.addEventListener('canplaythrough', () => {
            console.log('Audio can play through');
            this.audioBuffering = false;
        });
        
        this.audio.addEventListener('waiting', () => {
            console.log('Audio buffering');
            this.audioBuffering = true;
        });
        
        // Set up buffer monitoring
        setInterval(() => {
            if (this.audio && !this.audio.paused) {
                const buffered = this.audio.buffered;
                if (buffered.length > 0) {
                    const bufferedSeconds = buffered.end(buffered.length - 1) - this.audio.currentTime;
                    console.log(`Buffered: ${bufferedSeconds.toFixed(1)}s`);
                    
                    // If buffer is low, try to pause briefly to build buffer
                    if (bufferedSeconds < 30 && !this.audioBuffering) {
                        this.audioBuffering = true;
                        const wasPlaying = !this.audio.paused;
                        if (wasPlaying) {
                            this.audio.pause();
                            setTimeout(() => {
                                this.audio.play();
                                this.audioBuffering = false;
                            }, 2000);
                        }
                    }
                }
            }
        }, 5000);
    }
    
    startLocationTracking() {
        console.log('[DEBUG] Starting location tracking...');
        if (navigator.geolocation) {
            console.log('[DEBUG] Geolocation API is available.');
            navigator.geolocation.watchPosition(
                (position) => this.onLocationUpdate(position),
                (error) => this.onLocationError(error),
                {
                    enableHighAccuracy: true,
                    maximumAge: 10000,
                    timeout: 10000
                }
            );
        } else {
            console.error('[DEBUG] Geolocation is not supported by this browser.');
            alert('Geolocation is not supported by your browser');
        }
    }
    
    onLocationUpdate(position) {
        console.log('[DEBUG] onLocationUpdate: Received new position.', position);
        this.currentPosition = position;
        
        // Update user marker on map
        this.updateUserLocation(position);
        
        // Update speed display
        this.updateSpeed(position.coords.speed || 0);
        
        // Update speed limit
        this.updateSpeedLimit(position.coords);
        
        // Check if we need to update POIs
        if (!this.lastPoiUpdatePosition || 
            this.calculateDistance(
                this.lastPoiUpdatePosition.coords.latitude,
                this.lastPoiUpdatePosition.coords.longitude,
                position.coords.latitude,
                position.coords.longitude
            ) > this.updateThreshold) {
            
            this.updatePOIs(position.coords);
            this.updateServices(position.coords);
            this.lastPoiUpdatePosition = position;
        }
    }
    
    onLocationError(error) {
        console.error('[DEBUG] onLocationError: Geolocation failed.', error);
        let message = 'Location access error: ';
        
        switch(error.code) {
            case error.PERMISSION_DENIED:
                message += 'Please allow location access in your browser settings.';
                break;
            case error.POSITION_UNAVAILABLE:
                message += 'Location information is unavailable.';
                break;
            case error.TIMEOUT:
                message += 'Location request timed out.';
                break;
            default:
                message += error.message;
        }
        
        alert(message);
    }
    
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lon2-lon1) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    }
    
    updateUserLocation(position) {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        
        this.userMarker.setLatLng([lat, lng]);
        
        // Only pan if we're not too zoomed out
        if (this.map.getZoom() >= 14) {
            this.map.panTo([lat, lng], { animate: true, duration: 0.5 });
        }
    }
    
    updateSpeed(speed) {
        const speedKmh = speed * 3.6;
        document.getElementById('current-speed').textContent = `${speedKmh.toFixed(1)} km/h`;
    }
    
    async updateSpeedLimit(coords) {
        console.log('[DEBUG] Updating speed limit...');
        try {
            const speedLimit = await this.fetchSpeedLimitFromOSM(coords);
            console.log('[DEBUG] Fetched speed limit:', speedLimit);
            this.displaySpeedLimit(speedLimit);
        } catch (error) {
            console.error('[DEBUG] Failed to fetch speed limit:', error);
            this.displaySpeedLimit(null);
        }
    }
    
    displaySpeedLimit(speedLimit) {
        if (speedLimit) {
            document.getElementById('speed-limit').textContent = `Limit: ${Math.round(speedLimit)} km/h`;
        } else {
            document.getElementById('speed-limit').textContent = 'Limit: Unknown';
        }
    }
    
    async updatePOIs(coords) {
        console.log('[DEBUG] Updating POIs...');
        const cacheKey = `${Math.round(coords.latitude*1000)},${Math.round(coords.longitude*1000)}`;
        
        if (this.cache.pois[cacheKey] && 
            Date.now() - this.cache.pois[cacheKey].timestamp < 300000) {
            console.log('[DEBUG] Using cached POIs.');
            this.displayPOIs(this.cache.pois[cacheKey].data);
            return;
        }
        
        try {
            console.log('[DEBUG] Fetching new POIs from API...');
            const pois = await this.fetchPOIsFromOverpass(coords);
            console.log('[DEBUG] Successfully fetched POIs:', pois);
            
            this.cache.pois[cacheKey] = {
                data: pois,
                timestamp: Date.now()
            };
            
            this.displayPOIs(pois);
        } catch (error) {
            console.error('Failed to fetch POIs:', error);
        }
    }
    
    async fetchPOIsFromOverpass(coords) {
        const bboxSize = 0.01;
        const south = coords.latitude - bboxSize;
        const north = coords.latitude + bboxSize;
        const west = coords.longitude - bboxSize;
        const east = coords.longitude + bboxSize;
        
        const query = `
            [out:json][timeout:25];
            (
              node["tourism"="attraction"](${south},${west},${north},${east});
              node["historic"](${south},${west},${north},${east});
              node["amenity"="theatre"](${south},${west},${north},${east});
              node["amenity"="cinema"](${south},${west},${north},${east});
              node["amenity"="museum"](${south},${west},${north},${east});
              way["tourism"="attraction"](${south},${west},${north},${east});
              way["historic"](${south},${west},${north},${east});
              way["amenity"="theatre"](${south},${west},${north},${east});
              way["amenity"="cinema"](${south},${west},${north},${east});
              way["amenity"="museum"](${south},${west},${north},${east});
            );
            out center;
        `;
        
        // Use CORS proxy for Overpass API
        const encodedQuery = encodeURIComponent(query);
        const url = `https://overpass.kumi.systems/api/interpreter?data=${encodedQuery}`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Overpass API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        const nodes = data.elements.filter(el => el.type === 'node' && el.tags);
        const pois = [];
        
        for (let node of nodes) {
            if (!node.tags.name) continue;
            
            pois.push({
                name: node.tags.name,
                description: this.generatePOIDescription(node.tags),
                url: node.tags.wikipedia ? 
                    (node.tags.wikipedia.startsWith('http') ? 
                        node.tags.wikipedia : 
                        `https://en.wikipedia.org/wiki/${node.tags.wikipedia.replace(' ', '_')}`) :
                    `https://www.openstreetmap.org/node/${node.id}`,
                lat: node.lat,
                lng: node.lon,
                tags: node.tags
            });
        }
        
        const ways = data.elements.filter(el => el.type === 'way' && el.tags && el.center);
        for (let way of ways) {
            if (!way.tags.name) continue;
            
            pois.push({
                name: way.tags.name,
                description: this.generatePOIDescription(way.tags),
                url: way.tags.wikipedia ? 
                    (way.tags.wikipedia.startsWith('http') ? 
                        way.tags.wikipedia : 
                        `https://en.wikipedia.org/wiki/${way.tags.wikipedia.replace(' ', '_')}`) :
                    `https://www.openstreetmap.org/way/${way.id}`,
                lat: way.center.lat,
                lng: way.center.lon,
                tags: way.tags
            });
        }
        
        return pois.slice(0, 5);
    }
    
    generatePOIDescription(tags) {
        if (tags.tourism === 'attraction') {
            return `Tourist attraction${tags.description ? ': ' + tags.description : ''}`;
        }
        if (tags.historic) {
            return `Historic ${tags.historic}${tags.description ? ': ' + tags.description : ''}`;
        }
        if (tags.amenity === 'museum') {
            return `Museum${tags.description ? ': ' + tags.description : ''}`;
        }
        if (tags.amenity === 'theatre') {
            return `Theatre${tags.description ? ': ' + tags.description : ''}`;
        }
        if (tags.amenity === 'cinema') {
            return `Cinema${tags.description ? ': ' + tags.description : ''}`;
        }
        
        return Object.keys(tags)
            .filter(key => !['name', 'wikidata', 'wikipedia'].includes(key))
            .map(key => `${key}: ${tags[key]}`)
            .join(', ');
    }
    
    displayPOIs(pois) {
        this.clearPOIMarkers();
        
        pois.forEach(poi => {
            const marker = L.marker([poi.lat, poi.lng], {
                icon: L.divIcon({
                    className: 'poi-icon',
                    html: '<div style="background-color: #4285f4; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white;"></div>',
                    iconSize: [18, 18],
                    iconAnchor: [9, 9]
                })
            }).addTo(this.map);
            
            marker.on('click', () => this.showPOIModal(poi));
            this.poiMarkers.push(marker);
        });
    }
    
    clearPOIMarkers() {
        this.poiMarkers.forEach(marker => {
            if (this.map.hasLayer(marker)) {
                this.map.removeLayer(marker);
            }
        });
        this.poiMarkers = [];
    }
    
    showPOIModal(poi) {
        document.getElementById('poi-title').textContent = poi.name;
        document.getElementById('poi-description').textContent = poi.description;
        document.getElementById('poi-link').href = poi.url;
        document.getElementById('poi-link').textContent = `Learn more about ${poi.name}`;
        
        document.getElementById('poi-modal').style.display = 'block';
    }
    
    async updateServices(coords) {
        console.log('[DEBUG] Updating services...');
        const cacheKey = `${Math.round(coords.latitude*1000)},${Math.round(coords.longitude*1000)}`;
        
        if (this.cache.services[cacheKey] && 
            Date.now() - this.cache.services[cacheKey].timestamp < 300000) {
            console.log('[DEBUG] Using cached services.');
            this.displayServices(this.cache.services[cacheKey].data);
            return;
        }
        
        try {
            console.log('[DEBUG] Fetching new services from API...');
            const services = await this.fetchServicesFromOverpass(coords);
            console.log('[DEBUG] Successfully fetched services:', services);
            
            this.cache.services[cacheKey] = {
                 services,
                timestamp: Date.now()
            };
            
            this.displayServices(services);
        } catch (error) {
            console.error('Failed to fetch services:', error);
        }
    }
    
    async fetchServicesFromOverpass(coords) {
        const bboxSize = 0.03;
        const south = coords.latitude - bboxSize;
        const north = coords.latitude + bboxSize;
        const west = coords.longitude - bboxSize;
        const east = coords.longitude + bboxSize;
        
        const query = `
            [out:json][timeout:25];
            (
              node["amenity"="fuel"](${south},${west},${north},${east});
              node["amenity"="hospital"]["emergency"="yes"](${south},${west},${north},${east});
              node["amenity"="hospital"]["emergency"="emergency"](${south},${west},${north},${east});
              node["amenity"="cafe"](${south},${west},${north},${east});
              node["amenity"="toilets"](${south},${west},${north},${east});
            );
            out;
        `;
        
        const encodedQuery = encodeURIComponent(query);
        const url = `https://overpass.kumi.systems/api/interpreter?data=${encodedQuery}`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Overpass API error: ${response.status}`);
        }
        
        const data = await response.json();
        const nodes = data.elements.filter(el => el.type === 'node' && el.tags);
        
        const services = {
            petrol: null,
            hospital: null,
            cafe: null,
            toilet: null
        };
        
        nodes.forEach(node => {
            const distance = this.calculateDistance(coords.latitude, coords.longitude, node.lat, node.lon) / 1000;
            
            if (node.tags.amenity === 'fuel' && (!services.petrol || distance < services.petrol.distance)) {
                services.petrol = {
                    name: node.tags.name || 'Petrol Station',
                    distance: distance,
                    lat: node.lat,
                    lng: node.lon
                };
            }
            
            if (node.tags.amenity === 'hospital' && 
                (node.tags.emergency === 'yes' || node.tags.emergency === 'emergency') && 
                (!services.hospital || distance < services.hospital.distance)) {
                services.hospital = {
                    name: node.tags.name || 'Hospital',
                    distance: distance,
                    lat: node.lat,
                    lng: node.lon
                };
            }
            
            if (node.tags.amenity === 'cafe' && (!services.cafe || distance < services.cafe.distance)) {
                services.cafe = {
                    name: node.tags.name || 'Cafe',
                    distance: distance,
                    lat: node.lat,
                    lng: node.lon
                };
            }
            
            if (node.tags.amenity === 'toilets' && (!services.toilet || distance < services.toilet.distance)) {
                services.toilet = {
                    name: node.tags.name || 'Public Toilet',
                    distance: distance,
                    lat: node.lat,
                    lng: node.lon
                };
            }
        });
        
        return services;
    }
    
    displayServices(services) {
        if (services.petrol) {
            document.querySelector('#petrol-station .distance').textContent = 
                `${services.petrol.distance.toFixed(1)} km`;
            document.getElementById('petrol-station').dataset.location = 
                JSON.stringify(services.petrol);
        } else {
            document.querySelector('#petrol-station .distance').textContent = 'Not found';
        }
        
        if (services.hospital) {
            document.querySelector('#hospital .distance').textContent = 
                `${services.hospital.distance.toFixed(1)} km`;
            document.getElementById('hospital').dataset.location = 
                JSON.stringify(services.hospital);
        } else {
            document.querySelector('#hospital .distance').textContent = 'Not found';
        }
        
        if (services.cafe) {
            document.querySelector('#cafe .distance').textContent = 
                `${services.cafe.distance.toFixed(1)} km`;
            document.getElementById('cafe').dataset.location = 
                JSON.stringify(services.cafe);
        } else {
            document.querySelector('#cafe .distance').textContent = 'Not found';
        }
        
        if (services.toilet) {
            document.querySelector('#toilet .distance').textContent = 
                `${services.toilet.distance.toFixed(1)} km`;
            document.getElementById('toilet').dataset.location = 
                JSON.stringify(services.toilet);
        } else {
            document.querySelector('#toilet .distance').textContent = 'Not found';
        }
    }
    
    async fetchSpeedLimitFromOSM(coords) {
        const bboxSize = 0.001;
        const south = coords.latitude - bboxSize;
        const north = coords.latitude + bboxSize;
        const west = coords.longitude - bboxSize;
        const east = coords.longitude + bboxSize;
        
        const query = `
            [out:json][timeout:25];
            way(${south},${west},${north},${east})["maxspeed"];
            out;
        `;
        
        const encodedQuery = encodeURIComponent(query);
        const url = `https://overpass.kumi.systems/api/interpreter?data=${encodedQuery}`;
        
        const response = await fetch(url);
        if (!response.ok) {
            return null;
        }
        
        const data = await response.json();
        const ways = data.elements.filter(el => el.type === 'way' && el.tags && el.tags.maxspeed);
        
        if (ways.length === 0) {
            return null;
        }
        
        let speedLimitStr = ways[0].tags.maxspeed;
        
        if (typeof speedLimitStr === 'string') {
            speedLimitStr = speedLimitStr.replace(/\s*(km\/h|kph|kmh).*$/i, '');
            const speedLimit = parseInt(speedLimitStr);
            if (!isNaN(speedLimit)) {
                return speedLimit;
            }
        }
        
        return null;
    }
    
    setupEventListeners() {
        document.querySelector('.close').addEventListener('click', () => {
            document.getElementById('poi-modal').style.display = 'none';
        });
        
        window.addEventListener('click', (event) => {
            const modal = document.getElementById('poi-modal');
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
        
        document.getElementById('audio-toggle').addEventListener('click', () => {
            this.toggleAudio();
        });
        
        document.querySelectorAll('.service-icon').forEach(icon => {
            icon.addEventListener('click', (e) => {
                const serviceData = JSON.parse(e.currentTarget.dataset.location || '{}');
                if (serviceData.lat && serviceData.lng) {
                    this.navigateToLocation(serviceData.lat, serviceData.lng);
                }
            });
        });
    }
    
    toggleAudio() {
        const button = document.getElementById('audio-toggle');
        
        if (this.audio.paused) {
            this.audio.play()
                .then(() => {
                    button.textContent = '❚❚ Stop Radio';
                })
                .catch(error => {
                    console.error('Audio playback failed:', error);
                    alert('Audio playback failed. Please check your internet connection and try again.');
                });
        } else {
            this.audio.pause();
            button.textContent = '▶ Play Radio';
        }
    }
    
    navigateToLocation(lat, lng) {
        this.map.setView([lat, lng], 17);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] DOM fully loaded and parsed.');
    // Check for browser compatibility
    if (!('geolocation' in navigator)) {
        console.error('[DEBUG] Geolocation not supported, cannot initialize app.');
        document.getElementById('loading-screen').innerHTML = '<div style="text-align:center; padding:50px;"><h2>Geolocation Not Supported</h2><p>This app requires geolocation support. Please use a modern browser.</p></div>';
        return;
    }
    
    // Initialize the app
    console.log('[DEBUG] Initializing app from DOMContentLoaded.');
    window.app = new LocationTrackerApp();
});
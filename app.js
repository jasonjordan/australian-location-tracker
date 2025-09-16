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
        this.initialZoomDone = false;
        this.isDynamicallyZooming = false;
        this.currentRouteLayer = null;
        
        // Initialize after a small delay to ensure DOM is ready
        setTimeout(() => this.init(), 100);
    }
    
    init() {
        // Check if we're running in a secure context (HTTPS)
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
            alert('This app requires HTTPS for location services. Please access via HTTPS.');
            return;
        }
        
        this.setupMap();
        this.setupAudio();
        this.startLocationTracking();
        this.setupEventListeners();
        
        // Initialize service worker for offline support (Cloudflare Pages compatible)
        this.setupServiceWorker();
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

        // A short delay before invalidating size ensures the map container has its final dimensions
        setTimeout(() => this.map.invalidateSize(), 400);
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
        if (navigator.geolocation) {
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
            alert('Geolocation is not supported by your browser');
        }
    }
    
    onLocationUpdate(position) {
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
        console.error('Location error:', error);
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
        
        if (!this.initialZoomDone) {
            this.map.setView([lat, lng], 16, { animate: true, duration: 1.5 });
            this.initialZoomDone = true;
            this.startDynamicZoom();
        } else {
            // Only pan if we're not too zoomed out
            if (this.map.getZoom() >= 14) {
                this.map.panTo([lat, lng], { animate: true, duration: 1.5 });
            }
        }
    }
    
    updateSpeed(speed) {
        const speedKmh = speed * 3.6;
        document.getElementById('current-speed').textContent = `${speedKmh.toFixed(1)} km/h`;
    }
    
    async updateSpeedLimit(coords) {
        try {
            const speedLimit = await this.fetchSpeedLimitFromOSM(coords);
            this.displaySpeedLimit(speedLimit);
        } catch (error) {
            console.error('Failed to fetch speed limit:', error);
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
        const cacheKey = `${Math.round(coords.latitude*1000)},${Math.round(coords.longitude*1000)}`;
        
        if (this.cache.pois[cacheKey] && 
            Date.now() - this.cache.pois[cacheKey].timestamp < 300000) {
            this.displayPOIs(this.cache.pois[cacheKey].data);
            return;
        }
        
        try {
            const pois = await this.fetchPOIsFromOverpass(coords);
            
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
        const bboxSize = 0.1; // Increased search radius
        const south = coords.latitude - bboxSize;
        const north = coords.latitude + bboxSize;
        const west = coords.longitude - bboxSize;
        const east = coords.longitude + bboxSize;
        
        const query = `
            [out:json][timeout:25];
            (
              node["wikipedia"](${south},${west},${north},${east});
              way["wikipedia"](${south},${west},${north},${east});
              node["place"="city"](${south},${west},${north},${east});
              node["place"="town"](${south},${west},${north},${east});
              node["natural"="peak"](${south},${west},${north},${east});
              node["natural"="volcano"](${south},${west},${north},${east});
              node["waterway"="waterfall"](${south},${west},${north},${east});
              node["waterway"="dam"](${south},${west},${north},${east});
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
        const pois = this._formatOverpassPois(data.elements);
        return pois.slice(0, 5);
    }

    _formatOverpassPois(elements) {
        const pois = [];
        const nodes = elements.filter(el => el.type === 'node' && el.tags);
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
        
        const ways = elements.filter(el => el.type === 'way' && el.tags && el.center);
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
        return pois;
    }

    async fetchPOIsForBounds(bounds) {
        const south = bounds.getSouth();
        const west = bounds.getWest();
        const north = bounds.getNorth();
        const east = bounds.getEast();

        const query = `
            [out:json][timeout:25];
            (
              node["wikipedia"](${south},${west},${north},${east});
              way["wikipedia"](${south},${west},${north},${east});
              node["place"="city"](${south},${west},${north},${east});
              node["place"="town"](${south},${west},${north},${east});
              node["natural"="peak"](${south},${west},${north},${east});
              node["natural"="volcano"](${south},${west},${north},${east});
              node["waterway"="waterfall"](${south},${west},${north},${east});
              node["waterway"="dam"](${south},${west},${north},${east});
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
        return data.elements.filter(el => el.tags && el.tags.name);
    }

    startDynamicZoom() {
        console.log('Starting dynamic zoom to find POIs...');
        this.isDynamicallyZooming = true;
        this.findPoisByZoomingOut();
    }

    async findPoisByZoomingOut() {
        if (!this.isDynamicallyZooming) return;

        // Safety break to prevent infinite loops
        if (this.map.getZoom() < 8) {
            console.log('Dynamic zoom stopped: Reached minimum zoom level.');
            this.isDynamicallyZooming = false;
            this.displayPOIs(pois); // Display whatever was found
            return;
        }

        const elements = await this.fetchPOIsForBounds(this.map.getBounds());
        const pois = this._formatOverpassPois(elements);

        if (pois.length < 5) {
            this.map.zoomOut(1, { animate: true });
        } else {
            console.log(`Dynamic zoom finished: Found ${pois.length} POIs.`);
            this.isDynamicallyZooming = false;
            this.displayPOIs(pois);
        }
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

    async enrichPoiWithWikipediaData(poi) {
        if (poi.summary && poi.imageUrl) return poi;

        const wikiTag = poi.tags.wikipedia;
        if (!wikiTag) return poi;

        // Format is often "en:Article Title", so we split and take the last part.
        const pageTitle = wikiTag.split(':').pop().replace(/ /g, '_');
        const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${pageTitle}&prop=extracts|pageimages&pithumbsize=400&inprop=url&redirects=&format=json&origin=*&exintro&explaintext`;

        console.log(`Enriching POI: ${poi.name} from Wikipedia API`);

        try {
            const response = await fetch(url);
            const data = await response.json();
            const pages = data.query.pages;
            const page = pages[Object.keys(pages)[0]]; // Get the first (and only) page

            let summary = poi.description;
            let imageUrl = null;

            if (page.extract) {
                const words = page.extract.split(/\s+/);
                if (words.length > 100) {
                    summary = words.slice(0, 200).join(' ') + (words.length > 200 ? '...' : '');
                } else {
                    summary = page.extract;
                }
            }

            if (page.thumbnail && page.thumbnail.source) {
                imageUrl = page.thumbnail.source;
            }

            return { ...poi, summary, imageUrl };

        } catch (error) {
            console.error(`Failed to enrich POI data for ${poi.name}:`, error);
            return poi;
        }
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

            marker.poiData = poi; // Attach POI data to the marker

            let labelText = poi.name;
            if (this.currentPosition) {
                const distance = this.calculateDistance(
                    this.currentPosition.coords.latitude,
                    this.currentPosition.coords.longitude,
                    poi.lat,
                    poi.lng
                ) / 1000; // Convert to km
                labelText += ` (${distance.toFixed(1)} km)`;
            }

            marker.bindTooltip(labelText, {
                permanent: true,
                direction: 'top',
                offset: [0, -10],
                className: 'poi-label'
            }).openTooltip();
            
            // Only allow clicking on POIs that have a Wikipedia page to enrich
            if (poi.tags.wikipedia) {
                marker.on('click', () => this.showPOIModal(poi));
            }
            this.poiMarkers.push(marker);
        });

        this.openClosestPoiPopup();
    }

    openClosestPoiPopup() {
        if (!this.currentPosition || this.poiMarkers.length === 0) {
            return;
        }

        let closestMarker = null;
        let minDistance = Infinity;

        this.poiMarkers.forEach(marker => {
            const distance = this.calculateDistance(
                this.currentPosition.coords.latitude,
                this.currentPosition.coords.longitude,
                marker.poiData.lat,
                marker.poiData.lng
            );

            if (distance < minDistance) {
                minDistance = distance;
                closestMarker = marker;
            }
        });

        if (closestMarker) {
            // We need to bind a popup before we can open it.
            // The modal is shown on click, but for the closest one, we'll show a simple popup.
            closestMarker.bindPopup(`<b>${closestMarker.poiData.name}</b><br>${closestMarker.poiData.description}`).openPopup();

            // Pan the map to ensure the popup is not hidden by the services bar
            this.map.panBy([0, -100], { animate: true, duration: 1 });
        }
    }
    
    clearPOIMarkers() {
        this.poiMarkers.forEach(marker => {
            if (this.map.hasLayer(marker)) {
                this.map.removeLayer(marker);
            }
        });
        this.poiMarkers = [];
    }
    
    async showPOIModal(poi) {
        const modal = document.getElementById('poi-modal');
        const loader = document.getElementById('poi-loader');
        const content = document.getElementById('poi-content');
        const titleEl = document.getElementById('poi-title');
        const descriptionEl = document.getElementById('poi-description');
        const linkEl = document.getElementById('poi-link');
        const imageEl = document.getElementById('poi-image');

        // Reset and show loader
        content.style.display = 'none';
        loader.style.display = 'block';
        modal.style.display = 'block';

        const enrichedPoi = await this.enrichPoiWithWikipediaData(poi);

        // Populate content
        titleEl.textContent = enrichedPoi.name;
        linkEl.href = enrichedPoi.url;
        linkEl.textContent = `Learn more about ${enrichedPoi.name}`;
        descriptionEl.textContent = enrichedPoi.summary || enrichedPoi.description;

        if (enrichedPoi.imageUrl) {
            imageEl.src = enrichedPoi.imageUrl;
            imageEl.style.display = 'block';
        } else {
            imageEl.style.display = 'none';
        }

        // Hide loader and show content
        loader.style.display = 'none';
        content.style.display = 'block';
    }
    
    async updateServices(coords) {
        const cacheKey = `${Math.round(coords.latitude*1000)},${Math.round(coords.longitude*1000)}`;
        
        if (this.cache.services[cacheKey] && 
            Date.now() - this.cache.services[cacheKey].timestamp < 300000) {
            this.displayServices(this.cache.services[cacheKey].data);
            return;
        }
        
        try {
            const services = await this.fetchServicesFromOverpass(coords);
            
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
        const lat = coords.latitude;
        const lon = coords.longitude;
        const radius = 100000; // 100km radius

        const query = `
            [out:json][timeout:25];
            (
              node["amenity"="fuel"](around:${radius},${lat},${lon});
              node["amenity"="hospital"](around:${radius},${lat},${lon});
              node["amenity"="cafe"](around:${radius},${lat},${lon});
              node["amenity"="restaurant"](around:${radius},${lat},${lon});
              node["amenity"="toilets"](around:${radius},${lat},${lon});
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
                (!services.hospital || distance < services.hospital.distance)) {
                services.hospital = {
                    name: node.tags.name || 'Hospital',
                    distance: distance,
                    lat: node.lat,
                    lng: node.lon
                };
            }
            
            if ((node.tags.amenity === 'cafe' || node.tags.amenity === 'restaurant') && (!services.cafe || distance < services.cafe.distance)) {
                services.cafe = {
                    name: node.tags.name || (node.tags.amenity === 'cafe' ? 'Cafe' : 'Restaurant'),
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
        this.map.on('zoomend', () => {
            if (this.isDynamicallyZooming) {
                this.findPoisByZoomingOut();
            }
        });

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
                    this.showRouteToService(serviceData);
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
        this.map.setView([lat, lng], 17, { animate: true, duration: 1.5 });
    }

    async fetchRoute(start, end) {
        const startCoords = `${start.lng},${start.lat}`;
        const endCoords = `${end.lng},${end.lat}`;
        const url = `https://router.project-osrm.org/route/v1/driving/${startCoords};${endCoords}?overview=full&geometries=geojson`;

        try {
            const response = await fetch(url);
            const data = await response.json();
            if (data.code !== 'Ok') {
                throw new Error(data.message || 'Error fetching route');
            }
            // OSRM returns [lon, lat], Leaflet needs [lat, lon]
            const latlngs = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
            return latlngs;
        } catch (error) {
            console.error('Error fetching route:', error);
            alert('Could not fetch the route. Please try again.');
            return null;
        }
    }

    displayRoute(latlngs) {
        if (this.currentRouteLayer) {
            this.map.removeLayer(this.currentRouteLayer);
        }
        this.currentRouteLayer = L.polyline(latlngs, {
            color: '#3498db',
            weight: 5,
            opacity: 0.8
        }).addTo(this.map);
        this.map.fitBounds(this.currentRouteLayer.getBounds().pad(0.1), { animate: true, duration: 1.5 });
    }

    async showRouteToService(serviceData) {
        if (!this.currentPosition) {
            alert('Cannot calculate route without your current location.');
            return;
        }

        const start = {
            lat: this.currentPosition.coords.latitude,
            lng: this.currentPosition.coords.longitude
        };
        const end = {
            lat: serviceData.lat,
            lng: serviceData.lng
        };

        const latlngs = await this.fetchRoute(start, end);
        if (latlngs) {
            this.displayRoute(latlngs);
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Check for browser compatibility
    if (!('geolocation' in navigator)) {
        document.getElementById('loading-screen').innerHTML = '<div style="text-align:center; padding:50px;"><h2>Geolocation Not Supported</h2><p>This app requires geolocation support. Please use a modern browser.</p></div>';
        return;
    }
    
    // Initialize the app
    window.app = new LocationTrackerApp();
});
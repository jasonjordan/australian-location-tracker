// sw.js - Service Worker for Cloudflare Pages

const CACHE_NAME = 'au-location-tracker-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js'
];

// Install event
self.addEventListener('install', event => {
    console.log('Service Worker installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
});

// Activate event
self.addEventListener('activate', event => {
    console.log('Service Worker activating...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Fetch event
self.addEventListener('fetch', event => {
    // Don't intercept audio stream
    if (event.request.url.includes('happyradio.live') && event.request.url.includes('.mp3')) {
        return;
    }
    
    // Don't intercept Overpass API requests (they have their own caching)
    if (event.request.url.includes('overpass-api.de')) {
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Return cached response if found
                if (response) {
                    return response;
                }
                
                // Clone the request to avoid locking issues
                const fetchRequest = event.request.clone();
                
                return fetch(fetchRequest).then(
                    networkResponse => {
                        // Check if we received a valid response
                        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                            return networkResponse;
                        }
                        
                        // Clone the response for caching
                        const responseToCache = networkResponse.clone();
                        
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            });
                        
                        return networkResponse;
                    }
                );
            })
    );
});

// Handle messages from the app
self.addEventListener('message', event => {
    if (event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});
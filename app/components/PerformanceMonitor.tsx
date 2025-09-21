'use client';

import { useEffect } from 'react';

export default function PerformanceMonitor() {
  useEffect(() => {
    // Only run in production
    if (process.env.NODE_ENV !== 'production') return;

    // Track Core Web Vitals
    const trackWebVitals = () => {
      // Largest Contentful Paint (LCP)
      new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const lastEntry = entries[entries.length - 1];
        console.log('LCP:', lastEntry.startTime);
      }).observe({ entryTypes: ['largest-contentful-paint'] });

      // First Input Delay (FID)
      new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        entries.forEach((entry) => {
          const fidEntry = entry as PerformanceEventTiming;
          if (fidEntry.processingStart) {
            console.log('FID:', fidEntry.processingStart - fidEntry.startTime);
          }
        });
      }).observe({ entryTypes: ['first-input'] });

      // Cumulative Layout Shift (CLS)
      let clsValue = 0;
      new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        entries.forEach((entry) => {
          const clsEntry = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!clsEntry.hadRecentInput && clsEntry.value) {
            clsValue += clsEntry.value;
          }
        });
        console.log('CLS:', clsValue);
      }).observe({ entryTypes: ['layout-shift'] });

      // First Contentful Paint (FCP)
      new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        entries.forEach((entry) => {
          console.log('FCP:', entry.startTime);
        });
      }).observe({ entryTypes: ['paint'] });
    };

    // Track bundle size and load times
    const trackBundlePerformance = () => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      if (navigation) {
        console.log('Page Load Time:', navigation.loadEventEnd - navigation.fetchStart);
        console.log('DOM Content Loaded:', navigation.domContentLoadedEventEnd - navigation.fetchStart);
        console.log('First Byte:', navigation.responseStart - navigation.fetchStart);
      }

      // Track resource loading
      const resources = performance.getEntriesByType('resource');
      const jsResources = resources.filter(resource => resource.name.includes('.js'));
      const cssResources = resources.filter(resource => resource.name.includes('.css'));
      
      console.log('JS Resources:', jsResources.length);
      console.log('CSS Resources:', cssResources.length);
      
      const totalJSSize = jsResources.reduce((total, resource) => {
        const transferSize = (resource as PerformanceResourceTiming).transferSize || 0;
        return total + transferSize;
      }, 0);
      
      console.log('Total JS Size:', (totalJSSize / 1024).toFixed(2), 'KB');
    };

    // Run performance tracking
    trackWebVitals();
    trackBundlePerformance();

    // Track memory usage (if available)
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      console.log('Memory Usage:', {
        used: (memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
        total: (memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
        limit: (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + ' MB'
      });
    }

  }, []);

  return null;
}
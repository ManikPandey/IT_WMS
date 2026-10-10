import React, { useState, useEffect } from 'react';
import { Joyride, STATUS, EVENTS } from 'react-joyride';
import { useNavigate, useLocation } from 'react-router-dom';

export default function ProductTour() {
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();

  
  
  const token = localStorage.getItem('token');
  useEffect(() => {
    const hasSeenTour = localStorage.getItem('hasSeenTour');
    if (!hasSeenTour && token && location.pathname !== '/login') {
      setTimeout(() => setRun(true), 1000);
    }
  }, [location.pathname]);



  const steps = [
    {
      target: 'body',
      content: 'Welcome to the WMS System! Let\'s take a quick tour of the architecture.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: 'aside',
      content: 'This sidebar gives you access to all microservice modules, including CQRS Analytics and Redis Inventory.',
      placement: 'right',
    },
    {
      target: '#tour-sidebar-concurrency-demo',
      content: 'This is the most important feature! This demo proves our zero-overselling architecture. Click Next to go there now.',
      placement: 'right',
    },
    {
      target: '.demo-controls',
      content: 'Click this button to fire 100 concurrent requests. It proves that the Redis Circuit Breaker and Atomic Counters can handle a massive spike without overselling a single item!',
      placement: 'bottom',
    }
  ];

  
  const handleJoyrideCallback = (data) => {
    const { status, type, index, action } = data;
    
    // Log for debugging if needed
    console.log('Joyride:', type, action, status, index);

    if (status === 'finished' || status === 'skipped') {
      setRun(false);
      localStorage.setItem('hasSeenTour', 'true');
      return;
    }

    // Uncontrolled mode: just navigate when they leave step 2 (0-indexed)
    if (index === 2 && action === 'next' && type === 'step:after') {
      navigate('/concurrency-demo');
    }
  };


  return (
    <Joyride
      steps={steps}
      run={run}
      continuous={true}
      showSkipButton={true}
      showProgress={true}
      locale={{ skip: 'Skip Tour', next: 'Next', back: 'Back', last: 'Finish' }}
      callback={handleJoyrideCallback}
      styles={{
        options: {
          primaryColor: '#0ea5e9',
          zIndex: 100000,
        },
        buttonSkip: {
          color: '#ef4444',
          fontWeight: 600
        },
        overlay: {
          backgroundColor: 'rgba(0, 0, 0, 0.5)'
        }
      }}
    />
  );
}

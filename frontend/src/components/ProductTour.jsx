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
      target: '#tour-sidebar-dashboard',
      content: 'This Dashboard is powered by the CQRS Pattern. Reads are separated from writes to ensure ultra-fast analytics.',
      placement: 'right',
    },
    {
      target: '#tour-sidebar-inventory',
      content: 'The Inventory module uses Redis caching and Atomic Counters to keep track of stock lightning fast.',
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

    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status)) {
      setRun(false);
      localStorage.setItem('hasSeenTour', 'true');
    }

    if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      const nextStepIndex = index + (action === 'prev' ? -1 : 1);
      
      // If we just finished step 3 (Concurrency link) and clicked Next
      if (index === 3 && action === 'next') {
        navigate('/concurrency-demo');
        setTimeout(() => {
          setStepIndex(nextStepIndex);
        }, 500); // give the page time to load and render the .demo-controls target
      } else {
        setStepIndex(nextStepIndex);
      }
    }
  };

  return (
    <Joyride
      steps={steps}
      run={run}
      stepIndex={stepIndex}
      continuous={true}
      showSkipButton={true}
      showProgress={true}
      callback={handleJoyrideCallback}
      styles={{
        options: {
          primaryColor: '#0ea5e9', // Tailwind sky-500
          zIndex: 10000,
        },
      }}
    />
  );
}

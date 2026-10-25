import React, { useState, useEffect } from 'react';
import CanvasJSReact from '../addon/canvasjs.react';

const CanvasJSChart = CanvasJSReact.CanvasJSChart;

export default function Graph() {
  const [data, setData] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        // Binance public API — BTC/USDT hourly candles, last 24h
        const res = await fetch(
          'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=24'
        );
        const raw = await res.json();
        const points = raw.map(k => ({
          x: new Date(k[0]),
          y: [parseFloat(k[1]), parseFloat(k[2]), parseFloat(k[3]), parseFloat(k[4])],
          color: parseFloat(k[4]) >= parseFloat(k[1]) ? 'green' : 'red',
        }));
        setData(points);
      } catch (e) {
        console.error('Graph fetch failed', e);
      }
    })();
  }, []);

  if (!data.length) return null;

  return (
    <div className='sec-bg graph container'>
      <CanvasJSChart options={{
        theme: 'dark2',
        animationEnabled: true,
        title: { text: 'BTC/USD (Last 24 hours)' },
        height: '300',
        axisX: { valueFormatString: 'HH:00', labelFontColor: '#ffffff50', gridColor: '#000000', gridThickness: 1 },
        axisY: { includeZero: false, prefix: '$', labelFontColor: '#ffffff50', gridColor: '#000000' },
        backgroundColor: '#242424',
        data: [{ type: 'candlestick', risingColor: 'green', fallingColor: 'red', dataPoints: data }],
      }} />
    </div>
  );
}

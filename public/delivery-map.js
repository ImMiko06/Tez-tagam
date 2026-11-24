(()=>{
  const center=[43.2383,76.9455];
  const bounds={south:42.9,north:43.55,west:76.45,east:77.45};
  let map=null,marker=null;
  const form=document.querySelector('#checkout-form');
  const pointStatus=document.querySelector('#delivery-point-status');
  function withinAlmaty(lat,lng){return lat>=bounds.south&&lat<=bounds.north&&lng>=bounds.west&&lng<=bounds.east}
  function setPoint(lat,lng,zoom=true){
    if(!withinAlmaty(lat,lng)){pointStatus.textContent='Выберите точку в зоне доставки Алматы.';return false}
    if(!map)return false;
    const point=L.latLng(lat,lng);
    if(marker)marker.setLatLng(point);else marker=L.marker(point,{draggable:true}).addTo(map);
    marker.off('dragend').on('dragend',event=>{const p=event.target.getLatLng();setPoint(p.lat,p.lng,false)});
    form.elements.deliveryLat.value=lat.toFixed(6);form.elements.deliveryLng.value=lng.toFixed(6);
    pointStatus.textContent=`Точка выбрана: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if(zoom)map.setView(point,16);
    return true;
  }
  window.initDeliveryMap=()=>{
    if(!window.L){pointStatus.textContent='Карта не загрузилась. Проверьте интернет и обновите страницу.';return}
    if(!map){
      map=L.map('delivery-map',{scrollWheelZoom:false,maxBounds:[[bounds.south,bounds.west],[bounds.north,bounds.east]],maxBoundsViscosity:.85}).setView(center,13);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'}).addTo(map);
      map.on('click',event=>setPoint(event.latlng.lat,event.latlng.lng));
      document.querySelector('#locate-delivery').addEventListener('click',()=>{
        if(!navigator.geolocation){pointStatus.textContent='Браузер не поддерживает определение местоположения.';return}
        pointStatus.textContent='Определяем местоположение…';
        navigator.geolocation.getCurrentPosition(position=>{
          if(!setPoint(position.coords.latitude,position.coords.longitude)){pointStatus.textContent='Вы находитесь за пределами зоны доставки Алматы.'}
        },()=>{pointStatus.textContent='Не удалось определить местоположение. Можно выбрать точку нажатием на карту.'},{enableHighAccuracy:true,timeout:10000,maximumAge:60000});
      });
      form.addEventListener('reset',()=>setTimeout(()=>{if(marker){map.removeLayer(marker);marker=null}form.elements.deliveryLat.value='';form.elements.deliveryLng.value='';pointStatus.textContent='Точка на карте не выбрана'},0));
    }
    setTimeout(()=>map.invalidateSize(),100);
    const lat=Number(form.elements.deliveryLat.value),lng=Number(form.elements.deliveryLng.value);
    if(form.elements.deliveryLat.value&&form.elements.deliveryLng.value)setPoint(lat,lng,false);
  };
})();

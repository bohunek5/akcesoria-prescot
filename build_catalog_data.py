#!/usr/bin/env python3
"""
PRESCOT XML Catalog Processor
Fetches https://prescot.wapromag.pl/prescotcloud.xml and converts Prescot products
into a high-performance JSON structure for the web catalog.
"""

import urllib.request
import xml.etree.ElementTree as ET
import json
import os

def build_catalog():
    xml_url = 'https://prescot.wapromag.pl/prescotcloud.xml'
    print(f"Pobieranie XML z {xml_url}...")
    req = urllib.request.Request(xml_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as resp:
        xml_data = resp.read()

    print("Parsowanie struktury XML...")
    root = ET.fromstring(xml_data)

    products = []
    categories_tree = {}

    for o in root.findall('o'):
        attrs = {}
        attrs_elem = o.find('attrs')
        if attrs_elem is not None:
            for a in attrs_elem.findall('a'):
                name = a.attrib.get('name', '').strip()
                val = (a.text or '').strip()
                if name and val:
                    attrs[name] = val
                    
        prod = attrs.get('Producent') or o.findtext('producer') or ''
        if 'prescot' not in prod.lower():
            continue
            
        p_id = o.attrib.get('id', '')
        p_url = o.attrib.get('url', '')
        p_price = o.attrib.get('price', '0')
        p_stock = o.attrib.get('stock', '0')
        
        name = (o.findtext('name') or '').strip()
        cat_path = (o.findtext('cat') or 'Inne').strip()
        desc = (o.findtext('desc') or '').strip()
        
        main_img = ''
        extra_imgs = []
        imgs_elem = o.find('imgs')
        if imgs_elem is not None:
            main_elem = imgs_elem.find('main')
            if main_elem is not None:
                main_img = main_elem.attrib.get('url', '')
            for i_elem in imgs_elem.findall('i'):
                u = i_elem.attrib.get('url', '')
                if u and u != main_img:
                    extra_imgs.append(u)
                    
        cat_parts = [c.strip() for c in cat_path.split('/') if c.strip()]
        main_cat = cat_parts[0] if cat_parts else 'Inne'
        sub_cat = cat_parts[1] if len(cat_parts) > 1 else 'Ogólne'
        sub_sub_cat = '/'.join(cat_parts[2:]) if len(cat_parts) > 2 else ''
        
        sku = attrs.get('Kod_producenta') or attrs.get('Kod_produktu') or p_id
        ean = attrs.get('EAN', '')
        
        p_dict = {
            'id': p_id,
            'name': name,
            'sku': sku,
            'ean': ean,
            'producer': prod,
            'cat_path': cat_path,
            'main_cat': main_cat,
            'sub_cat': sub_cat,
            'sub_sub_cat': sub_sub_cat,
            'price': p_price,
            'stock': p_stock,
            'img': main_img,
            'extra_imgs': extra_imgs,
            'desc': desc,
            'attrs': attrs,
            'url': p_url
        }
        products.append(p_dict)
        
        if main_cat not in categories_tree:
            categories_tree[main_cat] = {}
        if sub_cat not in categories_tree[main_cat]:
            categories_tree[main_cat][sub_cat] = set()
        if sub_sub_cat:
            categories_tree[main_cat][sub_cat].add(sub_sub_cat)

    formatted_tree = {}
    for mc, subdict in categories_tree.items():
        formatted_tree[mc] = {}
        for sc, ssets in subdict.items():
            formatted_tree[mc][sc] = sorted(list(ssets))

    output = {
        'total': len(products),
        'categories': formatted_tree,
        'products': products
    }

    out_file = os.path.join(os.path.dirname(__file__), 'products_data.min.json')
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

    print(f"Pomyślnie wygenerowano {out_file} z {len(products)} produktami PRESCOT.")

if __name__ == '__main__':
    build_catalog()
